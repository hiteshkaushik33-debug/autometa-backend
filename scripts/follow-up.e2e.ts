import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { parseConfig } from '../packages/config/src';
import { digest, hashPassword } from '../api/src/security/crypto';
import { startEmailRuntime } from '../packages/email/src/runtime';
async function main() {
  if (process.env.NODE_ENV === 'production')
    throw new Error('DEVELOPMENT_ONLY');
  process.env.MAIL_PROVIDER = 'mock';
  process.env.EMAIL_FOLLOW_UP_ENABLED = 'true';
  const config = {
    ...parseConfig(process.env),
    EMAIL_GLOBAL_PER_MINUTE: 500,
    EMAIL_TENANT_PER_MINUTE: 100,
  };
  const db = new PrismaClient(),
    redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
  const { createApiApp } = await import('../api/src/bootstrap');
  const app = await createApiApp();
  await app.listen(0, '127.0.0.1');
  const base = (await app.getUrl()) + '/api/v1';
  const queueName = 'follow-up-test-' + randomUUID();
  let runtime = startEmailRuntime(db, redis, config, {
    queueName,
    dispatchOutbox: false,
  });
  const tenants: string[] = [];
  const request = async (
    path: string,
    token: string,
    method = 'GET',
    body?: unknown,
    key?: string,
  ) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        authorization: 'Bearer ' + token,
        'content-type': 'application/json',
        ...(key ? { 'idempotency-key': key } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, data: await res.json() };
  };
  const owner = async () => {
    const tenant = await db.tenant.create({
      data: {
        name: 'Follow-up fixture',
        status: 'ACTIVE',
        emailAutomation: { create: { enabled: true, followUpEnabled: true } },
      },
    });
    tenants.push(tenant.id);
    const password = 'Fixture-' + randomUUID(),
      email = randomUUID() + '@example.test';
    await db.user.create({
      data: {
        tenantId: tenant.id,
        email,
        passwordHash: await hashPassword(password),
        verifiedAt: new Date(),
      },
    });
    const login = await request('/auth/login', '', 'POST', { email, password });
    return { tenant, token: login.data.accessToken as string };
  };
  const wait = async (id: string, status: string) => {
    const end = Date.now() + 15000;
    while (Date.now() < end) {
      const m = await db.outboundEmail.findUniqueOrThrow({ where: { id } });
      if (m.status === status) return m;
      await new Promise((r) => setTimeout(r, 30));
    }
    throw new Error('WAIT_' + status);
  };
  try {
    const a = await owner(),
      b = await owner();
    const apiKey = 'auto_dev_' + randomUUID();
    await db.apiKey.create({
      data: {
        tenantId: a.tenant.id,
        name: 'Follow-up fixture',
        environment: 'development',
        prefix: 'auto_dev_',
        keyHash: digest(apiKey),
      },
    });
    const submit = async () => {
      const id = randomUUID();
      const r = await request(
        '/events',
        apiKey,
        'POST',
        {
          event: 'contact.created',
          externalEventId: id,
          contact: { name: 'Test customer', email: 'fixture@example.test' },
          data: { message: 'Please help with my inquiry.' },
          communicationPreferences: {
            emailTransactional: true,
            emailMarketing: false,
          },
          communicationEvidence: {
            basis: 'customer_request',
            source: 'contact-form',
            reference: id,
            occurredAt: new Date().toISOString(),
          },
        },
        'contact:' + id,
      );
      assert.equal(r.status, 202);
      const rootId = r.data.email.id as string;
      await runtime.queue.add(
        'send',
        { emailId: rootId, tenantId: a.tenant.id },
        { jobId: rootId },
      );
      const root = await wait(rootId, 'MOCK_ACCEPTED');
      const child = await db.outboundEmail.findUniqueOrThrow({
        where: { parentEmailId: rootId },
      });
      assert.equal(child.purpose, 'FOLLOW_UP');
      assert(child.scheduledAt && root.acceptedAt);
      const delta = child.scheduledAt.getTime() - root.acceptedAt.getTime();
      assert(delta >= 300000 && delta < 302000);
      return { root, child };
    };
    const first = await submit();
    await runtime.queue.add(
      'send',
      { emailId: first.root.id, tenantId: a.tenant.id },
      { jobId: randomUUID() },
    );
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(
      await db.outboundEmail.count({ where: { parentEmailId: first.root.id } }),
      1,
    );
    const job = await runtime.queue.add(
      'send',
      { emailId: first.child.id, tenantId: a.tenant.id },
      { jobId: first.child.id },
    );
    const until = Date.now() + 3000;
    while ((await job.getState()) !== 'delayed' && Date.now() < until)
      await new Promise((r) => setTimeout(r, 30));
    assert.equal(await job.getState(), 'delayed');
    assert.equal(
      (
        await db.outboundEmail.findUniqueOrThrow({
          where: { id: first.child.id },
        })
      ).attemptCount,
      0,
    );
    // Restart the worker; the due time is in PostgreSQL and delayed job is in Redis.
    await runtime.close();
    runtime = startEmailRuntime(db, redis, config, {
      queueName,
      dispatchOutbox: false,
    });
    await db.outboundEmail.update({
      where: { id: first.child.id },
      data: { scheduledAt: new Date(Date.now() - 1000) },
    });
    const restored = await runtime.queue.getJob(first.child.id);
    assert(restored);
    await restored.promote();
    await wait(first.child.id, 'MOCK_ACCEPTED');
    assert.equal(
      await db.outboundEmail.count({
        where: { parentEmailId: first.child.id },
      }),
      0,
    );
    const cancelled = await submit();
    assert.equal(
      (
        await request(
          '/email/messages/' + cancelled.child.id + '/cancel',
          b.token,
          'POST',
          {},
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await request(
          '/email/messages/' + cancelled.child.id + '/cancel',
          a.token,
          'POST',
          {},
        )
      ).status,
      200,
    );
    await runtime.queue.add(
      'send',
      { emailId: cancelled.child.id, tenantId: a.tenant.id },
      { jobId: cancelled.child.id },
    );
    await wait(cancelled.child.id, 'SUPPRESSED');
    assert.equal(
      (
        await db.outboundEmail.findUniqueOrThrow({
          where: { id: cancelled.child.id },
        })
      ).attemptCount,
      0,
    );
    const disabled = await submit();
    const settings = (await request('/email/overview', a.token)).data.settings;
    assert.equal(
      (
        await request('/email/settings', a.token, 'PUT', {
          enabled: true,
          followUpEnabled: false,
          enabledEvents: settings.enabledEvents,
          subject: settings.subject,
          body: settings.body,
          dailyLimit: settings.dailyLimit,
        })
      ).status,
      200,
    );
    assert.equal(
      (await wait(disabled.child.id, 'SUPPRESSED')).errorCode,
      'FOLLOW_UP_DISABLED',
    );
    const fourthId = randomUUID();
    const noChild = await db.outboundEmail.create({
      data: {
        id: fourthId,
        tenantId: a.tenant.id,
        purpose: 'AUTH',
        provider: 'mock',
        sender: config.MAIL_FROM,
        recipient: 'fixture@example.test',
        subject: 'No auth follow-ups',
        encryptedBody: first.root.encryptedBody,
      },
    });
    await runtime.queue.add(
      'send',
      { emailId: noChild.id, tenantId: a.tenant.id },
      { jobId: noChild.id },
    );
    await wait(noChild.id, 'MOCK_ACCEPTED');
    assert.equal(
      await db.outboundEmail.count({ where: { parentEmailId: noChild.id } }),
      0,
    );
    console.log(
      JSON.stringify({
        test: 'follow-up',
        status: 'passed',
        checks: [
          'five-minute-due-time',
          'one-follow-up-per-ack',
          'no-early-dispatch',
          'restart-recovery',
          'no-follow-up-chain',
          'tenant-scoped-cancel',
          'disable-cancels-pending',
          'auth-mail-excluded',
        ],
        realEmailSent: false,
      }),
    );
  } finally {
    await runtime.worker.pause();
    await runtime.queue.obliterate({ force: true });
    await runtime.close();
    await app.close();
    await db.auditLog.deleteMany({ where: { tenantId: { in: tenants } } });
    await db.user.deleteMany({ where: { tenantId: { in: tenants } } });
    await db.tenant.deleteMany({ where: { id: { in: tenants } } });
    for (const id of tenants)
      await db.usageCounter.deleteMany({
        where: {
          OR: [
            { key: { startsWith: 'email:mock:' + id + ':' } },
            { key: { startsWith: 'events:' + id + ':' } },
          ],
        },
      });
    await redis.quit();
    await db.$disconnect();
  }
}
void main().catch((e) => {
  console.error(
    JSON.stringify({
      test: 'follow-up',
      status: 'failed',
      code:
        e instanceof Error
          ? e.message.replace(/[^A-Za-z0-9_ .:-]/g, '').slice(0, 120)
          : 'UNKNOWN',
    }),
  );
  process.exitCode = 1;
});
