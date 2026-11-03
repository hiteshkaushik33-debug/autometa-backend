import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  MockEmailProvider,
  EmailService,
  ProviderError,
  classifySmtpError,
  GmailSmtpProvider,
} from '../packages/email/src/provider';
import { parseConfig } from '../packages/config/src';
const base = {
  DATABASE_URL: 'postgresql://local:local@localhost/db',
  REDIS_URL: 'redis://localhost:6379',
};
test('provider-independent service uses mock acceptance without real email', async () => {
  const service = new EmailService(new MockEmailProvider());
  const result = await service.send({
    id: randomUUID(),
    to: 'test@example.test',
    subject: 'Test acknowledgement',
    text: 'Your message was received.',
  });
  assert.equal(result.status, 'MOCK_ACCEPTED');
  assert.ok(result.messageId.startsWith('mock-'));
});
test('rejects email header injection', async () => {
  await assert.rejects(
    new MockEmailProvider().send({
      id: randomUUID(),
      to: 'test@example.test',
      subject: 'Hello\r\nBcc: other@example.test',
      text: 'Test',
    }),
    (e: unknown) => e instanceof ProviderError && e.code === 'INVALID_EMAIL',
  );
});
test('SMTP errors are redacted and ambiguous DATA failures are never blindly retried', () => {
  assert.equal(
    classifySmtpError({
      code: 'ETIMEDOUT',
      command: 'DATA',
      message: 'private-password',
    }).kind,
    'ambiguous',
  );
  assert.equal(classifySmtpError({ responseCode: 451 }).kind, 'transient');
  assert.equal(classifySmtpError({ responseCode: 550 }).kind, 'permanent');
  assert.equal(
    classifySmtpError({ code: 'ETIMEDOUT', command: 'CONN' }).kind,
    'transient',
  );
  assert.ok(
    !classifySmtpError({
      code: 'EAUTH',
      message: 'private-password',
    }).message.includes('private-password'),
  );
});
test('Gmail prevents arbitrary From identities', () => {
  const config = parseConfig({
    ...base,
    MAIL_PROVIDER: 'gmail',
    SMTP_USER: 'owner@example.test',
    SMTP_APP_PASSWORD: 'test-only',
    MAIL_FROM: 'impersonated@example.test',
  });
  assert.throws(
    () => new GmailSmtpProvider(config),
    (e: unknown) =>
      e instanceof ProviderError && e.code === 'SENDER_IDENTITY_INVALID',
  );
});
