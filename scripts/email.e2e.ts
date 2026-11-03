import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { parseConfig } from '../packages/config/src';
import { digest, seal, hashPassword } from '../api/src/security/crypto';
import { startEmailRuntime } from '../packages/email/src/runtime';
import { emailQuotaKey } from '../packages/email/src/store';

async function main() {
  if (process.env.NODE_ENV === 'production')
    throw new Error('DEVELOPMENT_ONLY');
  const live = process.argv.includes('--live');
  if (!live) process.env.MAIL_PROVIDER = 'mock';
  const config = parseConfig(process.env);
  if (live && config.MAIL_PROVIDER !== 'gmail')
    throw new Error('LIVE_REQUIRES_GMAIL');
  const recipient = live
    ? process.argv.find((x) => x.startsWith('--to='))?.slice(5)
    : 'fixture@example.test';
  if (!recipient) throw new Error('LIVE_REQUIRES_EXPLICIT_TO_ARGUMENT');
  const db = new PrismaClient();
  const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
  const { createApiApp } = await import('../api/src/bootstrap');
  const { notifyAutometa } =
    await import('../examples/external-client/autometa.mjs');
  const app = await createApiApp();
  await app.listen(0, '127.0.0.1');
  const base = (await app.getUrl()) + '/api/v1';
  const ids: string[] = [];
  const counters: string[] = [];
  const runtime = startEmailRuntime(db, redis, config);
  const fixture = async () => {
    const tenant = await db.tenant.create({
      data: {
        name: 'Email integration fixture',
        status: 'ACTIVE',
        emailAutomation: {
          create: { enabled: true, dailyLimit: config.EMAIL_TENANT_PER_DAY },
        },
      },
    });
    ids.push(tenant.id);
    const key = 'auto_dev_' + randomUUID();
    await db.apiKey.create({
      data: {
        tenantId: tenant.id,
        name: 'Fixture',
        environment: 'development',
        prefix: 'auto_dev_',
        keyHash: digest(key),
      },
    });
    counters.push(
      emailQuotaKey(config.MAIL_PROVIDER, tenant.id),
      'events:' + tenant.id + ':' + new Date().toISOString().slice(0, 10),
    );
    return { tenant, key };
  };
  const call = async (
    key: string,
    path: string,
    body?: unknown,
    id?: string,
  ) => {
    const response = await fetch(base + path, {
      method: body ? 'POST' : 'GET',
      headers: {
        authorization: 'Bearer ' + key,
        'content-type': 'application/json',
        ...(id ? { 'idempotency-key': id } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, data: await response.json() };
  };
  const event = (id = randomUUID()) => ({
    event: 'contact.created',
    externalEventId: id,
    contact: { name: 'Test customer', email: recipient },
    data: {
      source: 'external-contact-form',
      message: 'Testing a server-side third-party contact integration.',
    },
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
  });
  async function waitEmail(id: string, status: string) {
    const until = Date.now() + 90000;
    while (Date.now() < until) {
      const mail = await db.outboundEmail.findUniqueOrThrow({ where: { id } });
      if (mail.status === status) return mail;
      if (['FAILED', 'UNKNOWN', 'SUPPRESSED'].includes(mail.status))
        throw new Error('EMAIL_' + mail.status + '_' + mail.errorCode);
      await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error('EMAIL_WAIT_TIMEOUT');
  }
  let server: ReturnType<typeof createServer> | undefined;
  try {
    const a = await fixture();
    const b = await fixture();
    const input = event();
    const id = 'contact:' + input.externalEventId;
    // This represents an independent application's contact handler and storage.
    const saved: unknown[] = [];
    server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const part of req) chunks.push(Buffer.from(part));
      const contact = JSON.parse(Buffer.concat(chunks).toString());
      saved.push(contact);
      const result = await notifyAutometa(contact, {
        baseUrl: req.url === '/offline' ? 'http://127.0.0.1:1/api/v1' : base,
        apiKey: a.key,
        timeoutMs: 300,
      });
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({ saved: true, automationAccepted: result.accepted }),
      );
    });
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
    const address = server.address();
    assert(address && typeof address !== 'string');
    const external = 'http://127.0.0.1:' + address.port;
    const submitted = await fetch(external + '/contact', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    assert.equal(submitted.status, 201);
    assert.equal((await submitted.json()).automationAccepted, true);
    const duplicate = await Promise.all([
      call(a.key, '/events', input, id),
      call(a.key, '/events', input, id),
    ]);
    for (const r of duplicate) {
      assert.equal(r.status, 202);
      assert.equal(r.data.duplicate, true);
    }
    const receipt = duplicate[0].data;
    assert(receipt.email?.id);
    const accepted = await waitEmail(
      receipt.email.id,
      live ? 'SMTP_ACCEPTED' : 'MOCK_ACCEPTED',
    );
    assert.equal(accepted.attemptCount, 1);
    assert.equal(
      await db.integrationEvent.count({ where: { tenantId: a.tenant.id } }),
      1,
    );
    assert.equal(
      await db.outboundEmail.count({
        where: { integrationEventId: receipt.eventId },
      }),
      1,
    );
    assert.equal(
      (
        await call(
          a.key,
          '/events',
          { ...input, data: { ...input.data, message: 'Changed' } },
          id,
        )
      ).status,
      409,
    );
    assert.equal((await call(b.key, '/events/' + receipt.eventId)).status, 404);
    const offline = await fetch(external + '/offline', {
      method: 'POST',
      body: JSON.stringify(event()),
    });
    assert.equal(offline.status, 201);
    assert.equal((await offline.json()).automationAccepted, false);
    assert.equal(saved.length, 2);
    if (!live) {
      const password = 'Fixture-' + randomUUID();
      const owner = async (tenantId: string) => {
        const user = await db.user.create({
          data: {
            tenantId,
            email: randomUUID() + '@example.test',
            passwordHash: await hashPassword(password),
            verifiedAt: new Date(),
          },
        });
        return (await call('', '/auth/login', { email: user.email, password }))
          .data.accessToken as string;
      };
      const ownerA = await owner(a.tenant.id),
        ownerB = await owner(b.tenant.id);
      const ownerCall = async (
        token: string,
        path: string,
        method = 'GET',
        body?: unknown,
      ) => {
        const response = await fetch(base + path, {
          method,
          headers: {
            authorization: 'Bearer ' + token,
            'content-type': 'application/json',
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        return { status: response.status, data: await response.json() };
      };
      const overview = await ownerCall(ownerA, '/email/overview');
      assert.equal(overview.status, 200);
      const setting = overview.data.settings;
      assert.equal(
        (
          await ownerCall(ownerA, '/email/settings', 'PUT', {
            enabled: setting.enabled,
            enabledEvents: setting.enabledEvents,
            subject: setting.subject,
            body: setting.body,
            dailyLimit: setting.dailyLimit,
          })
        ).status,
        200,
      );
      const detail = await ownerCall(
        ownerA,
        '/email/messages/' + receipt.email.id,
      );
      assert.equal(detail.status, 200);
      assert.equal(detail.data.email.attempts.length, 1);
      assert.equal(
        (await ownerCall(ownerB, '/email/messages/' + receipt.email.id)).status,
        404,
      );
      assert.equal((await call(a.key, '/email/overview')).status, 401);
      const noPermission = {
        ...event(),
        communicationPreferences: {
          emailTransactional: false,
          emailMarketing: false,
        },
      };
      const no = await call(
        a.key,
        '/events',
        noPermission,
        'contact:' + noPermission.externalEventId,
      );
      assert.equal(no.status, 202);
      assert.equal(no.data.decision, 'TRANSACTIONAL_PERMISSION_REQUIRED');
      assert.equal(no.data.email, null);
      await db.emailSuppression.create({
        data: {
          tenantId: a.tenant.id,
          emailHash: digest(recipient),
          encryptedAddress: seal(
            recipient,
            config.AUTH_JWT_SECRET!,
            'suppression',
          ),
          reason: 'MANUAL_OPT_OUT',
        },
      });
      const suppressed = event();
      const sr = await call(
        a.key,
        '/events',
        suppressed,
        'contact:' + suppressed.externalEventId,
      );
      assert.equal(sr.data.decision, 'RECIPIENT_SUPPRESSED');
      assert.equal(sr.data.email, null);
      await db.emailSuppression.deleteMany({
        where: { tenantId: a.tenant.id },
      });
      await db.tenant.update({
        where: { id: b.tenant.id },
        data: { status: 'SUSPENDED' },
      });
      assert.equal(
        (await call(b.key, '/events', event(), 'suspended:' + randomUUID()))
          .status,
        403,
      );
      // A persisted SENDING lease is uncertain; replaying its job must not send.
      const uncertain = await db.outboundEmail.create({
        data: {
          tenantId: a.tenant.id,
          purpose: 'AUTH',
          provider: 'mock',
          sender: config.MAIL_FROM,
          recipient,
          subject: 'Uncertain fixture',
          encryptedBody: seal(
            'Test',
            config.AUTH_JWT_SECRET!,
            'outbound-email',
          ),
          status: 'SENDING',
          attemptCount: 1,
          dispatchToken: randomUUID(),
          leaseUntil: new Date(Date.now() - 1000),
          attempts: {
            create: { tenantId: a.tenant.id, number: 1, outcome: 'SENDING' },
          },
        },
      });
      await runtime.queue.add(
        'send',
        { emailId: uncertain.id, tenantId: a.tenant.id },
        { jobId: uncertain.id },
      );
      await waitEmail(uncertain.id, 'UNKNOWN');
      assert.equal(
        (
          await db.outboundEmail.findUniqueOrThrow({
            where: { id: uncertain.id },
          })
        ).attemptCount,
        1,
      );
      // Daily quota must block a second unique message, without sending it.
      await db.emailAutomation.update({
        where: { tenantId: a.tenant.id },
        data: { dailyLimit: 1 },
      });
      const limited = event();
      const lr = await call(
        a.key,
        '/events',
        limited,
        'contact:' + limited.externalEventId,
      );
      await waitEmail(lr.data.email.id, 'SUPPRESSED');
      await db.apiKey.updateMany({
        where: { tenantId: a.tenant.id },
        data: { revokedAt: new Date() },
      });
      assert.equal(
        (await call(a.key, '/events/' + receipt.eventId)).status,
        401,
      );
    }
    console.log(
      JSON.stringify({
        test: live ? 'live-email-integration' : 'mock-email-integration',
        status: 'passed',
        smtpStatus: live ? accepted.status : undefined,
        checks: [
          'external-contact-handler',
          'outage-preserves-contact',
          'async-202',
          'concurrent-idempotency',
          'payload-conflict',
          'tenant-isolation',
          ...(live
            ? []
            : [
                'permission',
                'suppression',
                'inactive-tenant',
                'uncertain-no-resend',
                'daily-quota',
                'revoked-key',
                'owner-settings-and-attempts',
                'owner-message-isolation',
              ]),
        ],
      }),
    );
  } finally {
    if (server) await new Promise<void>((r) => server!.close(() => r()));
    await runtime.close();
    await app.close();
    await db.auditLog.deleteMany({ where: { tenantId: { in: ids } } });
    await db.user.deleteMany({ where: { tenantId: { in: ids } } });
    await db.tenant.deleteMany({ where: { id: { in: ids } } });
    await db.usageCounter.deleteMany({ where: { key: { in: counters } } });
    await redis.quit();
    await db.$disconnect();
  }
}
void main().catch((e) => {
  console.error(
    JSON.stringify({
      test: 'email-integration',
      status: 'failed',
      code:
        e instanceof Error
          ? e.message.replace(/[^A-Za-z0-9_ :.-]/g, '').slice(0, 150)
          : 'UNKNOWN',
    }),
  );
  process.exitCode = 1;
});
