import nodemailer from 'nodemailer';
import { z } from 'zod';
import type { Config } from '../../config/src';

export type EmailInput = {
  id: string;
  to: string;
  subject: string;
  text: string;
};
export type EmailResult = {
  status: 'MOCK_ACCEPTED' | 'SMTP_ACCEPTED';
  messageId: string;
};
export interface EmailProvider {
  readonly name: 'mock' | 'gmail';
  verify(): Promise<void>;
  send(message: EmailInput): Promise<EmailResult>;
  close(): void;
}
export class ProviderError extends Error {
  constructor(
    readonly code: string,
    readonly kind: 'permanent' | 'transient' | 'ambiguous',
  ) {
    super(code);
  }
}
export function classifySmtpError(error: unknown): ProviderError {
  const e =
    error && typeof error === 'object'
      ? (error as Record<string, unknown>)
      : {};
  const response = typeof e.responseCode === 'number' ? e.responseCode : 0;
  if (e.code === 'EAUTH')
    return new ProviderError('SMTP_AUTH_FAILED', 'permanent');
  if (response >= 500 && response < 600)
    return new ProviderError('SMTP_REJECTED', 'permanent');
  if (response >= 400 && response < 500)
    return new ProviderError('SMTP_TEMPORARY_REJECTION', 'transient');
  if (e.code === 'EENVELOPE')
    return new ProviderError('SMTP_INVALID_ENVELOPE', 'permanent');
  if (
    e.code === 'EDNS' ||
    e.code === 'ECONNECTION' ||
    (typeof e.command === 'string' &&
      /^(CONN|EHLO|HELO|STARTTLS|AUTH|MAIL FROM|RCPT TO)$/i.test(e.command))
  )
    return new ProviderError('SMTP_CONNECTION_FAILED', 'transient');
  return new ProviderError('SMTP_OUTCOME_UNKNOWN', 'ambiguous');
}
export function recipientAllowed(config: Config, to: string) {
  return (
    config.MAIL_PROVIDER === 'mock' ||
    !config.EMAIL_TEST_MODE ||
    config.EMAIL_TEST_RECIPIENTS.split(',')
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean)
      .includes(to.trim().toLowerCase())
  );
}
function validate(message: EmailInput) {
  if (
    !z.uuid().safeParse(message.id).success ||
    !z.email().safeParse(message.to).success ||
    !message.subject ||
    message.subject.length > 200 ||
    /[\r\n]/.test(message.subject) ||
    !message.text ||
    message.text.length > 12000
  )
    throw new ProviderError('INVALID_EMAIL', 'permanent');
}
export class MockEmailProvider implements EmailProvider {
  readonly name = 'mock' as const;
  async verify() {}
  async send(message: EmailInput): Promise<EmailResult> {
    validate(message);
    return { status: 'MOCK_ACCEPTED', messageId: 'mock-' + message.id };
  }
  close() {}
}
type Transport = Pick<
  ReturnType<typeof nodemailer.createTransport>,
  'verify' | 'sendMail' | 'close'
>;
export class GmailSmtpProvider implements EmailProvider {
  readonly name = 'gmail' as const;
  private readonly transport: Transport;
  constructor(
    private readonly config: Config,
    transport?: Transport,
  ) {
    if (
      config.SMTP_HOST !== 'smtp.gmail.com' ||
      !z.email().safeParse(config.SMTP_USER).success ||
      config.MAIL_FROM.toLowerCase() !== config.SMTP_USER.trim().toLowerCase()
    )
      throw new ProviderError('SENDER_IDENTITY_INVALID', 'permanent');
    if (!(
      (config.SMTP_PORT === 465 && config.SMTP_SECURE) ||
      (config.SMTP_PORT === 587 && !config.SMTP_SECURE)
    ))
      throw new ProviderError('SMTP_TLS_CONFIGURATION_INVALID', 'permanent');
    this.transport =
      transport ??
      nodemailer.createTransport({
        host: config.SMTP_HOST,
        port: config.SMTP_PORT,
        secure: config.SMTP_SECURE,
        requireTLS: !config.SMTP_SECURE,
        auth: {
          user: config.SMTP_USER,
          pass: config.SMTP_APP_PASSWORD.replace(/\s/g, ''),
        },
        tls: {
          rejectUnauthorized: true,
          minVersion: 'TLSv1.2',
          servername: config.SMTP_HOST,
        },
        connectionTimeout: 7000,
        greetingTimeout: 7000,
        socketTimeout: 15000,
        logger: false,
        debug: false,
        disableFileAccess: true,
        disableUrlAccess: true,
      });
  }
  async verify() {
    try {
      await this.transport.verify();
    } catch (e) {
      throw classifySmtpError(e);
    }
  }
  async send(message: EmailInput): Promise<EmailResult> {
    validate(message);
    if (
      !recipientAllowed({ ...this.config, MAIL_PROVIDER: 'gmail' }, message.to)
    )
      throw new ProviderError('TEST_RECIPIENT_BLOCKED', 'permanent');
    try {
      const result = await this.transport.sendMail({
        from: this.config.MAIL_FROM,
        to: message.to,
        subject: message.subject,
        text: message.text,
        messageId:
          '<' + message.id + '@' + this.config.MAIL_FROM.split('@')[1] + '>',
        headers: {
          'Auto-Submitted': 'auto-generated',
          'X-Autometa-Message-ID': message.id,
        },
      });
      if (!Array.isArray(result.accepted) || !result.accepted.length)
        throw new ProviderError('SMTP_REJECTED', 'permanent');
      return { status: 'SMTP_ACCEPTED', messageId: String(result.messageId) };
    } catch (e) {
      if (e instanceof ProviderError) throw e;
      throw classifySmtpError(e);
    }
  }
  close() {
    this.transport.close();
  }
}
export function createEmailProvider(config: Config): EmailProvider {
  return config.MAIL_PROVIDER === 'mock'
    ? new MockEmailProvider()
    : new GmailSmtpProvider(config);
}
export class EmailService {
  constructor(private readonly provider: EmailProvider) {}
  verify() {
    return this.provider.verify();
  }
  send(message: EmailInput) {
    return this.provider.send(message);
  }
  close() {
    this.provider.close();
  }
}
