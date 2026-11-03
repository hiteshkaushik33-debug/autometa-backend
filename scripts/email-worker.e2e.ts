import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { parseConfig } from '../packages/config/src';
import { seal } from '../api/src/security/crypto';
import {
  MockEmailProvider,
  ProviderError,
  type EmailProvider,
} from '../packages/email/src/provider';
import { startEmailRuntime } from '../packages/email/src/runtime';
import { emailQuotaKey } from '../packages/email/src/store';
async function main() {
  if (process.env.NODE_ENV === 'production')
    throw new Error('DEVELOPMENT_ONLY');
  const config = {
    ...parseConfig({ ...process.env, MAIL_PROVIDER: 'mock' }),
    EMAIL_GLOBAL_PER_MINUTE: 500,
    EMAIL_TENANT_PER_MINUTE: 100,
  };
  const db = new PrismaClient(),
    redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
  const tenant = await db.tenant.create({
    data: { name: 'Worker failure fixture', status: 'ACTIVE' },
  });
  const calls = new Map<string, number>(),
    mock = new MockEmailProvider();
  const provider: EmailProvider = {
    name: 'mock',
    async verify() {},
    close() {},
    async send(m) {
      const n = (calls.get(m.id) ?? 0) + 1;
      calls.set(m.id, n);
      if (m.subject === 'transient' && n < 3)
        throw new ProviderError('SMTP_TEMPORARY_REJECTION', 'transient');
      if (m.subject === 'permanent')
        throw new ProviderError('SMTP_REJECTED', 'permanent');
      if (m.subject === 'ambiguous')
        throw new ProviderError('SMTP_OUTCOME_UNKNOWN', 'ambiguous');
      return mock.send(m);
    },
  };
  const runtime = startEmailRuntime(db, redis, config, {
    provider,
    queueName: 'email-test-' + randomUUID(),
    dispatchOutbox: false,
  });
  const create = async (subject: string) =>
    db.outboundEmail.create({
      data: {
        tenantId: tenant.id,
        purpose: 'AUTH',
        provider: 'mock',
        sender: config.MAIL_FROM,
        recipient: 'fixture@example.test',
        subject,
        encryptedBody: seal(
          'Worker test',
          config.AUTH_JWT_SECRET!,
          'outbound-email',
        ),
        expiresAt: new Date(Date.now() + 60000),
      },
    });
  const add = (id: string, jobId = id, tenantId = tenant.id) =>
    runtime.queue.add(
      'send',
      { emailId: id, tenantId },
      { jobId, attempts: 3, backoff: { type: 'exponential', delay: 50 } },
    );
  const wait = async (id: string, status: string) => {
    const end = Date.now() + 15000;
    while (Date.now() < end) {
      const row = await db.outboundEmail.findUniqueOrThrow({ where: { id } });
      if (row.status === status) return row;
      await new Promise((r) => setTimeout(r, 30));
    }
    throw new Error('WORKER_STATUS_TIMEOUT_' + status);
  };
  const rateKey = () =>
    `mail-rate:mock:${tenant.id}:${Math.floor(Date.now() / 60000)}`;
  try {
    const transient = await create('transient');
    await add(transient.id);
    const sent = await wait(transient.id, 'MOCK_ACCEPTED');
    assert.equal(sent.attemptCount, 3);
    assert.equal(calls.get(sent.id), 3);
    const attempts = await db.emailAttempt.findMany({
      where: { emailId: sent.id },
      orderBy: { number: 'asc' },
    });
    assert.deepEqual(
      attempts.map((a) => a.outcome),
      ['RETRY', 'RETRY', 'MOCK_ACCEPTED'],
    );
    const permanent = await create('permanent');
    await add(permanent.id);
    assert.equal((await wait(permanent.id, 'FAILED')).attemptCount, 1);
    assert.equal(calls.get(permanent.id), 1);
    const ambiguous = await create('ambiguous');
    await add(ambiguous.id);
    await wait(ambiguous.id, 'UNKNOWN');
    await add(ambiguous.id, randomUUID());
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(calls.get(ambiguous.id), 1);
    // A forged tenant ID in a queue payload cannot claim or send this message.
    const scoped = await create('scope');
    const wrong = await add(scoped.id, randomUUID(), randomUUID());
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(await wrong.getState(), 'completed');
    assert.equal(calls.has(scoped.id), false);
    await add(scoped.id);
    await wait(scoped.id, 'MOCK_ACCEPTED');
    // Atomic minute limits delay before SMTP, without consuming a send attempt.
    await redis.set(rateKey(), 100, 'EX', 120);
    const rate = await create('rate');
    const delayed = await add(rate.id);
    const end = Date.now() + 3000;
    while ((await delayed.getState()) !== 'delayed' && Date.now() < end)
      await new Promise((r) => setTimeout(r, 25));
    assert.equal(await delayed.getState(), 'delayed');
    assert.equal(
      (await db.outboundEmail.findUniqueOrThrow({ where: { id: rate.id } }))
        .attemptCount,
      0,
    );
    await redis.del(rateKey());
    await delayed.promote();
    await wait(rate.id, 'MOCK_ACCEPTED');
    await db.usageCounter.upsert({
      where: { key: emailQuotaKey('mock', tenant.id) },
      create: {
        key: emailQuotaKey('mock', tenant.id),
        quantity: config.EMAIL_TENANT_PER_DAY,
      },
      update: { quantity: config.EMAIL_TENANT_PER_DAY },
    });
    const quota = await create('quota');
    await add(quota.id);
    await wait(quota.id, 'SUPPRESSED');
    assert.equal(calls.has(quota.id), false);
    console.log(
      JSON.stringify({
        test: 'email-worker-failures',
        status: 'passed',
        checks: [
          'exponential-retry',
          'attempt-history',
          'permanent-no-retry',
          'ambiguous-no-resend',
          'queue-tenant-binding',
          'minute-rate-delay',
          'daily-quota',
        ],
      }),
    );
  } finally {
    await runtime.worker.pause();
    await runtime.queue.obliterate({ force: true });
    await runtime.close();
    await db.tenant.delete({ where: { id: tenant.id } });
    await db.usageCounter.deleteMany({
      where: { key: { startsWith: 'email:mock:' + tenant.id + ':' } },
    });
    await redis.del(rateKey());
    await redis.quit();
    await db.$disconnect();
  }
}
void main().catch(() => {
  console.error(
    JSON.stringify({
      test: 'email-worker-failures',
      status: 'failed',
      code: 'CHECK_FAILED',
    }),
  );
  process.exitCode = 1;
});
