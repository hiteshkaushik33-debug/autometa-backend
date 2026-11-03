import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { Config } from '../../config/src';
import { seal } from '../../../api/src/security/crypto';
import { recipientAllowed } from './provider';
export const EMAIL_QUEUE = 'outbound-email';
export type EnqueueEmail = {
  tenantId: string | null;
  userId?: string | null;
  integrationEventId?: string;
  parentEmailId?: string;
  scheduledAt?: Date;
  purpose: 'AUTH' | 'ACK' | 'FOLLOW_UP';
  billingCostPaise?: number;
  to: string;
  subject: string;
  text: string;
  expiresAt?: Date;
};
export async function enqueueEmail(
  tx: Prisma.TransactionClient,
  input: EnqueueEmail,
  config: Config,
) {
  if (!config.AUTH_JWT_SECRET) throw new Error('EMAIL_ENCRYPTION_KEY_MISSING');
  const allowed = recipientAllowed(config, input.to);
  const email = await tx.outboundEmail.create({
    data: {
      id: randomUUID(),
      tenantId: input.tenantId,
      userId: input.userId ?? null,
      integrationEventId: input.integrationEventId,
      parentEmailId: input.parentEmailId,
      scheduledAt: input.scheduledAt,
      purpose: input.purpose,
      billingCostPaise:
        input.billingCostPaise ??
        (config.BILLING_ENABLED &&
        input.purpose !== 'AUTH' &&
        (config.MAIL_PROVIDER !== 'mock' || config.BILLING_CHARGE_MOCK_EMAILS)
          ? config.BILLING_EMAIL_PRICE_PAISE
          : 0),
      provider: config.MAIL_PROVIDER,
      sender: config.MAIL_FROM,
      recipient: input.to.trim().toLowerCase(),
      subject: input.subject.replace(/[\r\n]/g, ' ').slice(0, 200),
      encryptedBody: seal(input.text, config.AUTH_JWT_SECRET, 'outbound-email'),
      expiresAt: input.expiresAt ?? new Date(Date.now() + 86400_000),
      status: allowed ? 'QUEUED' : 'SUPPRESSED',
      errorCode: allowed ? null : 'TEST_RECIPIENT_BLOCKED',
    },
  });
  if (allowed)
    await tx.emailOutbox.create({
      data: { tenantId: input.tenantId, emailId: email.id },
    });
  return email;
}
export class QuotaError extends Error {}
export async function reserveCounter(
  tx: Prisma.TransactionClient,
  key: string,
  limit: number,
) {
  await tx.usageCounter.upsert({
    where: { key },
    create: { key, quantity: 0 },
    update: {},
  });
  const result = await tx.usageCounter.updateMany({
    where: { key, quantity: { lt: limit } },
    data: { quantity: { increment: 1 } },
  });
  if (!result.count) throw new QuotaError('QUOTA_EXCEEDED');
}
export const utcDay = () => new Date().toISOString().slice(0, 10);
export const emailQuotaKey = (
  provider: string,
  tenantId: string | null,
  day = utcDay(),
) => 'email:' + provider + ':' + (tenantId ?? 'global') + ':' + day;
export function renderTemplate(template: string, vars: Record<string, string>) {
  return template.replace(
    /\{\{(businessName|contactName|reference)\}\}/g,
    (_, key: string) => vars[key] ?? '',
  );
}
