import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { DelayedError, Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import type { Config } from '../../config/src';
import { scheduleFollowUp } from './follow-up';
import { reserveEmailCredit, settleEmailCredit } from './credits';
import { digest, unseal } from '../../../api/src/security/crypto';
import {
  createEmailProvider,
  MockEmailProvider,
  ProviderError,
  recipientAllowed,
  type EmailProvider,
} from './provider';
import {
  EMAIL_QUEUE,
  emailQuotaKey,
  QuotaError,
  reserveCounter,
  utcDay,
} from './store';

type Payload = { emailId: string; tenantId: string | null };
const terminal = [
  'MOCK_ACCEPTED',
  'SMTP_ACCEPTED',
  'SUPPRESSED',
  'FAILED',
  'UNKNOWN',
];
export function startEmailRuntime(
  db: PrismaClient,
  redis: Redis,
  config: Config,
  options: {
    provider?: EmailProvider;
    queueName?: string;
    dispatchOutbox?: boolean;
  } = {},
) {
  const queueName = options.queueName ?? EMAIL_QUEUE;
  const queue = new Queue<Payload>(queueName, { connection: redis });
  const mock = new MockEmailProvider();
  const provider = options.provider ?? createEmailProvider(config);
  let stopping = false,
    polling = false;
  const worker = new Worker<Payload>(
    queueName,
    async (job, token) => {
      const payload = job.data;
      if (
        !payload ||
        typeof payload.emailId !== 'string' ||
        !(payload.tenantId === null || typeof payload.tenantId === 'string')
      )
        return;
      let message = await db.outboundEmail.findFirst({
        where: { id: payload.emailId, tenantId: payload.tenantId },
      });
      if (!message || terminal.includes(message.status)) return;
      if (message.scheduledAt && message.scheduledAt > new Date()) {
        await job.moveToDelayed(message.scheduledAt.getTime(), token);
        throw new DelayedError();
      }
      if (message.status === 'SENDING') {
        if (message.leaseUntil && message.leaseUntil > new Date()) {
          await job.moveToDelayed(Date.now() + 10000, token);
          throw new DelayedError();
        }
        await db.$transaction(async (tx) => {
          const changed = await tx.outboundEmail.updateMany({
            where: {
              id: message!.id,
              status: 'SENDING',
              dispatchToken: message!.dispatchToken,
            },
            data: { status: 'UNKNOWN', errorCode: 'SEND_LEASE_EXPIRED' },
          });
          if (changed.count)
            await tx.emailAttempt.updateMany({
              where: { emailId: message!.id, outcome: 'SENDING' },
              data: {
                outcome: 'UNKNOWN',
                safeCode: 'SEND_LEASE_EXPIRED',
                finishedAt: new Date(),
              },
            });
        });
        return;
      }
      const minute = Math.floor(Date.now() / 60000);
      const rate = await redis.eval(
        "local a=tonumber(redis.call('GET',KEYS[1]) or '0'); local b=tonumber(redis.call('GET',KEYS[2]) or '0'); if a>=tonumber(ARGV[1]) or b>=tonumber(ARGV[2]) then return 0 end; redis.call('INCR',KEYS[1]);redis.call('EXPIRE',KEYS[1],120);redis.call('INCR',KEYS[2]);redis.call('EXPIRE',KEYS[2],120);return 1",
        2,
        `mail-rate:${message.provider}:global:${minute}`,
        `mail-rate:${message.provider}:${message.tenantId ?? 'platform'}:${minute}`,
        config.EMAIL_GLOBAL_PER_MINUTE,
        config.EMAIL_TENANT_PER_MINUTE,
      );
      if (!Number(rate)) {
        await job.moveToDelayed((minute + 1) * 60000 + 100, token);
        throw new DelayedError();
      }
      const dispatchToken = randomUUID();
      let waitingForCredits = false;
      try {
        message = await db.$transaction(async (tx) => {
          await tx.$queryRaw(
            Prisma.sql`SELECT "id" FROM "OutboundEmail" WHERE "id"=${payload.emailId}::uuid FOR UPDATE`,
          );
          const m = await tx.outboundEmail.findFirst({
            where: { id: payload.emailId, tenantId: payload.tenantId },
            include: {
              tenant: true,
              integrationEvent: { include: { contact: true } },
              parentEmail: {
                include: { integrationEvent: { include: { contact: true } } },
              },
            },
          });
          if (!m || !['QUEUED', 'RETRY', 'WAITING_CREDITS'].includes(m.status))
            return null;
          let blocked: string | null = null;
          if (m.expiresAt && m.expiresAt <= new Date())
            blocked = 'EMAIL_EXPIRED';
          if (
            m.provider !== 'mock' &&
            (config.MAIL_PROVIDER !== 'gmail' ||
              m.provider !== 'gmail' ||
              m.sender !== config.MAIL_FROM)
          )
            blocked = 'PROVIDER_CONFIGURATION_CHANGED';
          if (m.provider !== 'mock' && !recipientAllowed(config, m.recipient))
            blocked = 'TEST_RECIPIENT_BLOCKED';
          if (
            m.tenant &&
            (m.tenant.status === 'SUSPENDED' ||
              (m.tenant.status === 'TRIAL' &&
                m.tenant.trialEndsAt <= new Date()))
          )
            blocked = 'TENANT_INACTIVE';
          let dailyLimit = config.EMAIL_TENANT_PER_DAY;
          if (
            (m.purpose === 'ACK' || m.purpose === 'FOLLOW_UP') &&
            m.tenantId
          ) {
            const event =
              m.purpose === 'FOLLOW_UP'
                ? m.parentEmail?.integrationEvent
                : m.integrationEvent;
            const setting = await tx.emailAutomation.findUnique({
              where: { tenantId: m.tenantId },
            });
            dailyLimit = Math.min(
              dailyLimit,
              setting?.dailyLimit ?? dailyLimit,
            );
            if (
              !setting?.enabled ||
              !setting.enabledEvents.includes(event?.eventType ?? '')
            )
              blocked = 'AUTOMATION_DISABLED';
            if (!event?.contact.transactionalAllowed)
              blocked = 'TRANSACTIONAL_PERMISSION_REQUIRED';
            if (
              m.purpose === 'FOLLOW_UP' &&
              (!config.EMAIL_FOLLOW_UP_ENABLED || !setting?.followUpEnabled)
            )
              blocked = 'FOLLOW_UP_DISABLED';
            if (
              m.purpose === 'FOLLOW_UP' &&
              (!m.parentEmail ||
                m.parentEmail.tenantId !== m.tenantId ||
                m.parentEmail.purpose !== 'ACK' ||
                !['MOCK_ACCEPTED', 'SMTP_ACCEPTED'].includes(
                  m.parentEmail.status,
                ))
            )
              blocked = 'PARENT_EMAIL_NOT_ACCEPTED';
            if (
              await tx.emailSuppression.findUnique({
                where: {
                  tenantId_emailHash: {
                    tenantId: m.tenantId,
                    emailHash: digest(m.recipient),
                  },
                },
              })
            )
              blocked = 'RECIPIENT_SUPPRESSED';
          }
          if (blocked) {
            await tx.outboundEmail.update({
              where: { id: m.id },
              data: { status: 'SUPPRESSED', errorCode: blocked },
            });
            await settleEmailCredit(tx, m.id, m.tenantId, 'RELEASE');
            return null;
          }
          const credit = await reserveEmailCredit(tx, m);
          if (credit !== 'reserved') {
            await tx.outboundEmail.update({
              where: { id: m.id },
              data: {
                status: 'WAITING_CREDITS',
                errorCode:
                  credit === 'blocked'
                    ? 'BILLING_REVIEW_REQUIRED'
                    : 'INSUFFICIENT_CREDITS',
              },
            });
            waitingForCredits = true;
            return null;
          }
          if (!m.quotaDay) {
            await reserveCounter(
              tx,
              emailQuotaKey(m.provider, null),
              config.EMAIL_GLOBAL_PER_DAY,
            );
            if (m.tenantId)
              await reserveCounter(
                tx,
                emailQuotaKey(m.provider, m.tenantId),
                dailyLimit,
              );
          }
          const updated = await tx.outboundEmail.update({
            where: { id: m.id },
            data: {
              status: 'SENDING',
              dispatchToken,
              leaseUntil: new Date(Date.now() + 120000),
              quotaDay: m.quotaDay ?? utcDay(),
              attemptCount: { increment: 1 },
              errorCode: null,
            },
          });
          await tx.emailAttempt.create({
            data: {
              tenantId: m.tenantId,
              emailId: m.id,
              number: updated.attemptCount,
              outcome: 'SENDING',
            },
          });
          return updated;
        });
      } catch (e) {
        if (e instanceof QuotaError) {
          await db.$transaction(async (tx) => {
            const changed = await tx.outboundEmail.updateMany({
              where: {
                id: payload.emailId,
                tenantId: payload.tenantId,
                status: { in: ['QUEUED', 'RETRY', 'WAITING_CREDITS'] },
              },
              data: {
                status: 'SUPPRESSED',
                errorCode: 'EMAIL_DAILY_QUOTA_EXCEEDED',
              },
            });
            if (changed.count)
              await settleEmailCredit(
                tx,
                payload.emailId,
                payload.tenantId,
                'RELEASE',
              );
          });
          return;
        }
        throw new Error('EMAIL_DATABASE_UNAVAILABLE');
      }
      if (waitingForCredits) {
        await job.moveToDelayed(Date.now() + 60000, token);
        throw new DelayedError();
      }
      if (!message) return;
      let result;
      try {
        const sender =
          options.provider ?? (message.provider === 'mock' ? mock : provider);
        let text: string;
        try {
          text = unseal(
            message.encryptedBody,
            config.AUTH_JWT_SECRET!,
            'outbound-email',
          );
        } catch {
          throw new ProviderError('EMAIL_CONTENT_UNAVAILABLE', 'permanent');
        }
        result = await sender.send({
          id: message.id,
          to: message.recipient,
          subject: message.subject,
          text,
        });
      } catch (e) {
        const error =
          e instanceof ProviderError
            ? e
            : new ProviderError('SEND_OUTCOME_UNKNOWN', 'ambiguous');
        const retry =
          error.kind === 'transient' &&
          job.attemptsMade + 1 < (job.opts.attempts ?? 5);
        const status =
          error.kind === 'ambiguous' ? 'UNKNOWN' : retry ? 'RETRY' : 'FAILED';
        await db.$transaction(async (tx) => {
          const changed = await tx.outboundEmail.updateMany({
            where: { id: message!.id, status: 'SENDING', dispatchToken },
            data: { status, errorCode: error.code, leaseUntil: null },
          });
          await tx.emailAttempt.updateMany({
            where: {
              emailId: message!.id,
              number: message!.attemptCount,
              outcome: 'SENDING',
            },
            data: {
              outcome: status,
              safeCode: error.code,
              finishedAt: new Date(),
            },
          });
          if (changed.count && status === 'FAILED')
            await settleEmailCredit(
              tx,
              message!.id,
              message!.tenantId,
              'RELEASE',
            );
        });
        if (retry) throw new Error(error.code);
        return;
      }
      // If this commit fails after SMTP acceptance, retain SENDING. Recovery marks UNKNOWN;
      // it must never send again based on an uncertain database acknowledgement.
      await db.$transaction(async (tx) => {
        const changed = await tx.outboundEmail.updateMany({
          where: { id: message!.id, status: 'SENDING', dispatchToken },
          data: {
            status: result.status,
            providerMessageId: result.messageId,
            acceptedAt: new Date(),
            leaseUntil: null,
          },
        });
        if (changed.count) {
          await settleEmailCredit(
            tx,
            message!.id,
            message!.tenantId,
            'CAPTURE',
          );
          await tx.emailAttempt.updateMany({
            where: {
              emailId: message!.id,
              number: message!.attemptCount,
              outcome: 'SENDING',
            },
            data: { outcome: result.status, finishedAt: new Date() },
          });
          await scheduleFollowUp(tx, message!, new Date(), config);
        }
      });
    },
    { connection: redis, concurrency: 2 },
  );
  worker.on('error', () =>
    console.error(
      JSON.stringify({ service: 'email-worker', code: 'QUEUE_UNAVAILABLE' }),
    ),
  );
  worker.on('failed', (job) => {
    console.error(
      JSON.stringify({ service: 'email-worker', code: 'ATTEMPT_FAILED' }),
    );
    if (job && job.attemptsMade >= (job.opts.attempts ?? 5))
      void db
        .$transaction(async (tx) => {
          const changed = await tx.outboundEmail.updateMany({
            where: {
              id: job.data.emailId,
              tenantId: job.data.tenantId,
              status: { in: ['QUEUED', 'RETRY', 'WAITING_CREDITS'] },
            },
            data: { status: 'FAILED', errorCode: 'QUEUE_ATTEMPTS_EXHAUSTED' },
          });
          if (changed.count)
            await settleEmailCredit(
              tx,
              job.data.emailId,
              job.data.tenantId,
              'RELEASE',
            );
        })
        .catch(() => {});
  });

  async function poll() {
    if (stopping || polling) return;
    polling = true;
    try {
      // A sender crash or uncertain commit cannot trigger a duplicate SMTP send.
      await db.$transaction(async (tx) => {
        await tx.emailAttempt.updateMany({
          where: {
            outcome: 'SENDING',
            email: { status: 'SENDING', leaseUntil: { lt: new Date() } },
          },
          data: {
            outcome: 'UNKNOWN',
            safeCode: 'SEND_LEASE_EXPIRED',
            finishedAt: new Date(),
          },
        });
        await tx.outboundEmail.updateMany({
          where: { status: 'SENDING', leaseUntil: { lt: new Date() } },
          data: {
            status: 'UNKNOWN',
            errorCode: 'SEND_LEASE_EXPIRED',
            leaseUntil: null,
          },
        });
      });
      const rows = await db.emailOutbox.findMany({
        where: {
          publishedAt: null,
          OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }],
        },
        take: 20,
        orderBy: { createdAt: 'asc' },
      });
      for (const row of rows) {
        const pending = await db.outboundEmail.findUnique({
          where: { id: row.emailId },
          select: { scheduledAt: true },
        });
        const claimToken = randomUUID();
        const claimed = await db.emailOutbox.updateMany({
          where: {
            id: row.id,
            publishedAt: null,
            OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }],
          },
          data: {
            claimToken,
            leaseUntil: new Date(Date.now() + 30000),
            attempts: { increment: 1 },
          },
        });
        if (!claimed.count) continue;
        await queue.add(
          'send',
          { emailId: row.emailId, tenantId: row.tenantId },
          {
            jobId: row.emailId,
            delay: Math.max(
              0,
              (pending?.scheduledAt?.getTime() ?? Date.now()) - Date.now(),
            ),
            attempts: 5,
            backoff: { type: 'exponential', delay: 2000 },
            removeOnComplete: { age: 86400 },
            removeOnFail: { age: 7 * 86400 },
          },
        );
        await db.emailOutbox.updateMany({
          where: { id: row.id, claimToken },
          data: { publishedAt: new Date(), leaseUntil: null },
        });
      }
    } catch {
      console.error(
        JSON.stringify({
          service: 'email-outbox',
          code: 'DISPATCH_UNAVAILABLE',
        }),
      );
    } finally {
      polling = false;
    }
  }
  const timer =
    options.dispatchOutbox === false
      ? undefined
      : setInterval(() => void poll(), 1000);
  if (options.dispatchOutbox !== false) void poll();
  return {
    worker,
    queue,
    async close() {
      stopping = true;
      clearInterval(timer);
      while (polling) await new Promise((r) => setTimeout(r, 50));
      await worker.close();
      await queue.close();
      provider.close();
      mock.close();
    },
  };
}
