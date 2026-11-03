import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { parseConfig } from '../packages/config/src';
import { digest, hashPassword, seal } from '../api/src/security/crypto';
import {
  PAYMENT_PROVIDER,
  MockPaymentProvider,
} from '../api/src/billing/provider';
import { enqueueEmail } from '../packages/email/src/store';
import { startEmailRuntime } from '../packages/email/src/runtime';
import {
  MockEmailProvider,
  ProviderError,
  type EmailProvider,
} from '../packages/email/src/provider';
async function main() {
  if (process.env.NODE_ENV === 'production')
    throw new Error('DEVELOPMENT_ONLY');
  Object.assign(process.env, {
    NODE_ENV: 'test',
    MAIL_PROVIDER: 'mock',
    BILLING_ENABLED: 'true',
    BILLING_PROVIDER: 'mock',
    BILLING_CHARGE_MOCK_EMAILS: 'true',
    BILLING_EMAIL_PRICE_PAISE: '100',
    EMAIL_FOLLOW_UP_ENABLED: 'false',
    RAZORPAY_KEY_ID: 'rzp_test_fixture',
    RAZORPAY_KEY_SECRET: randomUUID(),
    RAZORPAY_WEBHOOK_SECRET: randomUUID(),
  });
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
  const gateway = app.get<MockPaymentProvider>(PAYMENT_PROVIDER);
  assert(gateway instanceof MockPaymentProvider);
  const calls = new Map<string, number>(),
    mock = new MockEmailProvider();
  const provider: EmailProvider = {
    name: 'mock',
    verify: async () => {},
    close() {},
    async send(m) {
      const n = (calls.get(m.id) ?? 0) + 1;
      calls.set(m.id, n);
      if (m.subject === 'permanent')
        throw new ProviderError('SMTP_REJECTED', 'permanent');
      if (m.subject === 'ambiguous')
        throw new ProviderError('SMTP_OUTCOME_UNKNOWN', 'ambiguous');
      if (m.subject === 'transient' && n < 3)
        throw new ProviderError('SMTP_TEMPORARY_REJECTION', 'transient');
      return mock.send(m);
    },
  };
  const runtime = startEmailRuntime(db, redis, config, {
    provider,
    queueName: 'billing-test-' + randomUUID(),
    dispatchOutbox: false,
  });
  const tenants: string[] = [],
    users: string[] = [],
    hooks: string[] = [];
  const req = async (
    path: string,
    token = '',
    method = 'GET',
    body?: unknown,
  ) => {
    const r = await fetch(base + path, {
      method,
      headers: {
        authorization: 'Bearer ' + token,
        'content-type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, data: await r.json() };
  };
  const owner = async (admin = false) => {
    const t = admin
      ? null
      : await db.tenant.create({
          data: {
            name: 'Billing fixture',
            emailAutomation: { create: { enabled: true } },
          },
        });
    if (t) tenants.push(t.id);
    const password = 'Fixture-' + randomUUID(),
      email = randomUUID() + '@example.test';
    const user = await db.user.create({
      data: {
        email,
        passwordHash: await hashPassword(password),
        verifiedAt: new Date(),
        role: admin ? 'SUPER_ADMIN' : 'TENANT_ADMIN',
        tenantId: t?.id,
      },
    });
    users.push(user.id);
    const r = await req('/auth/login', '', 'POST', { email, password });
    assert.equal(r.status, 200);
    return { tenantId: t?.id ?? '', token: r.data.accessToken as string };
  };
  const signature = (orderId: string, paymentId: string) =>
    createHmac('sha256', config.RAZORPAY_KEY_SECRET)
      .update(orderId + '|' + paymentId)
      .digest('hex');
  const webhook = async (
    paymentId: string,
    type = 'payment.captured',
    eventId = 'evt_' + randomUUID().replaceAll('-', ''),
  ) => {
    hooks.push(eventId);
    const raw = JSON.stringify(
      { event: type, payload: { payment: { entity: { id: paymentId } } } },
      null,
      2,
    );
    const sig = createHmac('sha256', config.RAZORPAY_WEBHOOK_SECRET)
      .update(raw)
      .digest('hex');
    const r = await fetch(base + '/billing/razorpay/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-razorpay-signature': sig,
        'x-razorpay-event-id': eventId,
      },
      body: raw,
    });
    return { status: r.status, data: await r.json(), raw, sig, eventId };
  };
  const account = async (id: string) =>
    (await db.creditAccount.findUnique({ where: { tenantId: id } })) ?? {
      availablePaise: 0,
      reservedPaise: 0,
      blocked: false,
    };
  const wait = async (id: string, status: string) => {
    const until = Date.now() + 15000;
    while (Date.now() < until) {
      const m = await db.outboundEmail.findUniqueOrThrow({ where: { id } });
      if (m.status === status) return m;
      await new Promise((r) => setTimeout(r, 30));
    }
    throw new Error('WAIT_' + status);
  };
  const send = async (
    tenantId: string,
    subject: string,
    cost?: number,
    purpose: 'ACK' | 'AUTH' = 'ACK',
  ) => {
    const m = await db.$transaction(async (tx) => {
      let eventId: string | undefined;
      if (purpose === 'ACK') {
        const contact = await tx.contact.upsert({
          where: {
            tenantId_email: { tenantId, email: 'fixture@example.test' },
          },
          create: {
            tenantId,
            email: 'fixture@example.test',
            name: 'Test',
            transactionalAllowed: true,
          },
          update: { transactionalAllowed: true },
        });
        const id = randomUUID();
        const event = await tx.integrationEvent.create({
          data: {
            tenantId,
            environment: 'development',
            externalEventId: id,
            idempotencyKey: 'billing:' + id,
            payloadHash: digest(id),
            encryptedPayload: seal(
              '{}',
              config.AUTH_JWT_SECRET!,
              'event-payload',
            ),
            contactId: contact.id,
            eventType: 'contact.created',
            emailDecision: 'EMAIL_QUEUED',
          },
        });
        eventId = event.id;
      }
      const row = await enqueueEmail(
        tx,
        {
          tenantId,
          purpose,
          integrationEventId: eventId,
          to: 'fixture@example.test',
          subject,
          text: 'Billing test',
          billingCostPaise: cost,
        },
        config,
      );
      await tx.emailOutbox.deleteMany({ where: { emailId: row.id } });
      return row;
    });
    await runtime.queue.add(
      'send',
      { emailId: m.id, tenantId },
      { jobId: m.id, attempts: 3, backoff: { type: 'exponential', delay: 50 } },
    );
    return m;
  };
  try {
    const a = await owner(),
      b = await owner(),
      admin = await owner(true);
    await db.tenant.update({
      where: { id: a.tenantId },
      data: { trialEndsAt: new Date(Date.now() - 60000) },
    });
    assert.equal(
      (
        await req('/billing/topups', a.token, 'POST', {
          packId: 'starter',
          requestId: randomUUID(),
          amountPaise: 1,
        })
      ).status,
      400,
    );
    const requestId = randomUUID();
    const created = await req('/billing/topups', a.token, 'POST', {
      packId: 'starter',
      requestId,
    });
    assert.equal(created.status, 201);
    const order = created.data;
    assert.equal(order.amountPaise, 10000);
    assert.equal((await account(a.tenantId)).availablePaise, 0);
    const duplicate = await Promise.all([
      req('/billing/topups', a.token, 'POST', { packId: 'starter', requestId }),
      req('/billing/topups', a.token, 'POST', { packId: 'starter', requestId }),
    ]);
    assert(
      duplicate.every((x) => x.data.providerOrderId === order.providerOrderId),
    );
    assert.equal(gateway.orders.size, 1);
    assert.equal(
      (
        await req('/billing/topups', a.token, 'POST', {
          packId: 'growth',
          requestId,
        })
      ).status,
      409,
    );
    const p = gateway.capture(order.providerOrderId, 'authorized');
    const verify = {
      topUpId: order.topUpId,
      paymentId: p.id,
      signature: signature(order.providerOrderId, p.id),
    };
    assert.equal(
      (await req('/billing/verify', b.token, 'POST', verify)).status,
      404,
    );
    assert.equal(
      (
        await req('/billing/verify', a.token, 'POST', {
          ...verify,
          signature: '0'.repeat(64),
        })
      ).status,
      400,
    );
    assert.equal(
      (await req('/billing/verify', a.token, 'POST', verify)).data.credited,
      false,
    );
    assert.equal((await account(a.tenantId)).availablePaise, 0);
    p.status = 'captured';
    p.captured = true;
    p.amount = 1;
    assert.equal(
      (await req('/billing/verify', a.token, 'POST', verify)).status,
      400,
    );
    p.amount = 10000;
    const eventId = 'evt_' + randomUUID().replaceAll('-', '');
    const confirms = await Promise.all([
      req('/billing/verify', a.token, 'POST', verify),
      req('/billing/verify', a.token, 'POST', verify),
      webhook(p.id, 'payment.captured', eventId),
      webhook(p.id, 'payment.captured', eventId),
    ]);
    assert(confirms.every((r) => r.status === 200));
    assert.equal((await account(a.tenantId)).availablePaise, 10000);
    assert.equal(
      await db.creditLedger.count({
        where: { tenantId: a.tenantId, kind: 'TOP_UP' },
      }),
      1,
    );
    assert.equal(
      (await db.tenant.findUniqueOrThrow({ where: { id: a.tenantId } })).status,
      'ACTIVE',
    );
    const rawHook = await webhook(p.id);
    const tampered = await fetch(base + '/billing/razorpay/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-razorpay-signature': rawHook.sig,
      },
      body: rawHook.raw + ' ',
    });
    assert.equal(tampered.status, 400);
    assert.equal(
      (
        await req(
          '/billing/topups/' + order.topUpId + '/reconcile',
          b.token,
          'POST',
          {},
        )
      ).status,
      404,
    );
    assert.equal((await req('/admin/billing', a.token)).status, 403);
    assert.equal((await req('/admin/billing', admin.token)).status, 200);
    const success = await send(a.tenantId, 'success');
    assert.equal(success.billingCostPaise, 100);
    await wait(success.id, 'MOCK_ACCEPTED');
    assert.equal((await account(a.tenantId)).availablePaise, 9900);
    assert.equal((await account(a.tenantId)).reservedPaise, 0);
    await runtime.queue.add(
      'send',
      { emailId: success.id, tenantId: a.tenantId },
      { jobId: randomUUID() },
    );
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(
      await db.creditLedger.count({
        where: { tenantId: a.tenantId, reference: 'capture:' + success.id },
      }),
      1,
    );
    const transient = await send(a.tenantId, 'transient');
    assert.equal((await wait(transient.id, 'MOCK_ACCEPTED')).attemptCount, 3);
    assert.equal((await account(a.tenantId)).availablePaise, 9800);
    const permanent = await send(a.tenantId, 'permanent');
    await wait(permanent.id, 'FAILED');
    assert.equal((await account(a.tenantId)).availablePaise, 9800);
    assert.equal((await account(a.tenantId)).reservedPaise, 0);
    const ambiguous = await send(a.tenantId, 'ambiguous');
    await wait(ambiguous.id, 'UNKNOWN');
    assert.equal((await account(a.tenantId)).availablePaise, 9700);
    assert.equal((await account(a.tenantId)).reservedPaise, 100);
    await db.tenant.update({
      where: { id: b.tenantId },
      data: { status: 'ACTIVE' },
    });
    const pending = await send(b.tenantId, 'waiting');
    const paused = await wait(pending.id, 'WAITING_CREDITS');
    assert.equal(paused.attemptCount, 0);
    assert.equal(paused.errorCode, 'INSUFFICIENT_CREDITS');
    const bOrder = (
      await req('/billing/topups', b.token, 'POST', {
        packId: 'starter',
        requestId: randomUUID(),
      })
    ).data;
    const bp = gateway.capture(bOrder.providerOrderId);
    assert.equal(
      (
        await req('/billing/verify', b.token, 'POST', {
          topUpId: bOrder.topUpId,
          paymentId: bp.id,
          signature: signature(bOrder.providerOrderId, bp.id),
        })
      ).status,
      200,
    );
    const delayed = await runtime.queue.getJob(pending.id);
    assert(delayed);
    const delayUntil = Date.now() + 2000;
    while ((await delayed.getState()) !== 'delayed' && Date.now() < delayUntil)
      await new Promise((r) => setTimeout(r, 30));
    await delayed.promote();
    await wait(pending.id, 'MOCK_ACCEPTED');
    assert.equal((await account(b.tenantId)).availablePaise, 9900);
    const race = await Promise.all([
      send(b.tenantId, 'race-one', 9900),
      send(b.tenantId, 'race-two', 9900),
    ]);
    const end = Date.now() + 5000;
    let states: string[] = [];
    while (Date.now() < end) {
      states = (
        await db.outboundEmail.findMany({
          where: { id: { in: race.map((x) => x.id) } },
        })
      ).map((x) => x.status);
      if (
        states.includes('MOCK_ACCEPTED') &&
        states.includes('WAITING_CREDITS')
      )
        break;
      await new Promise((r) => setTimeout(r, 30));
    }
    assert.deepEqual(states.sort(), ['MOCK_ACCEPTED', 'WAITING_CREDITS']);
    assert.equal((await account(b.tenantId)).availablePaise, 0);
    assert.equal((await account(b.tenantId)).reservedPaise, 0);
    p.amount_refunded = 1000;
    const refunded = await webhook(p.id, 'refund.processed');
    assert.equal(refunded.status, 200);
    await webhook(p.id, 'refund.processed', refunded.eventId);
    assert.equal((await account(a.tenantId)).availablePaise, 8700);
    assert.equal(
      await db.creditLedger.count({
        where: { tenantId: a.tenantId, kind: 'REFUND' },
      }),
      1,
    );
    p.amount_refunded = 10000;
    p.status = 'refunded';
    assert.equal(
      (
        await req(
          '/billing/topups/' + order.topUpId + '/reconcile',
          a.token,
          'POST',
          {},
        )
      ).status,
      200,
    );
    assert.equal((await account(a.tenantId)).availablePaise, -300);
    assert.equal((await webhook(bp.id, 'payment.dispute.created')).status, 200);
    assert.equal((await account(b.tenantId)).blocked, true);
    const review = await send(b.tenantId, 'review');
    assert.equal(
      (await wait(review.id, 'WAITING_CREDITS')).errorCode,
      'BILLING_REVIEW_REQUIRED',
    );
    const auth = await send(b.tenantId, 'Authentication', undefined, 'AUTH');
    assert.equal(auth.billingCostPaise, 0);
    await wait(auth.id, 'MOCK_ACCEPTED');
    assert.equal(
      await db.emailCreditHold.count({ where: { emailId: auth.id } }),
      0,
    );
    console.log(
      JSON.stringify({
        test: 'prepaid-billing',
        status: 'passed',
        checks: [
          'test-only-provider',
          'server-pack-pricing',
          'idempotent-orders',
          'tenant-isolation',
          'signature-verification',
          'capture-required',
          'amount-verification',
          'raw-webhook-signature',
          'concurrent-callback-deduplication',
          'trial-activation',
          'reserve-and-charge-once',
          'retry-no-double-charge',
          'failure-release',
          'unknown-held',
          'insufficient-balance-pause-and-resume',
          'concurrent-no-overspend',
          'refund-deduplication',
          'dispute-review',
          'free-auth-mail',
        ],
        realPayments: false,
        realEmails: false,
      }),
    );
  } finally {
    await runtime.worker.pause();
    await runtime.queue.obliterate({ force: true });
    await runtime.close();
    await app.close();
    await db.paymentWebhook.deleteMany({ where: { eventId: { in: hooks } } });
    await db.auditLog.deleteMany({ where: { tenantId: { in: tenants } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.tenant.deleteMany({ where: { id: { in: tenants } } });
    for (const id of tenants)
      await db.usageCounter.deleteMany({ where: { key: { contains: id } } });
    await redis.quit();
    await db.$disconnect();
  }
}
void main().catch((e) => {
  console.error(
    JSON.stringify({
      test: 'prepaid-billing',
      status: 'failed',
      code:
        e instanceof Error
          ? e.message.replace(/[^A-Za-z0-9_ :.-]/g, '').slice(0, 160)
          : 'UNKNOWN',
    }),
  );
  process.exitCode = 1;
});
