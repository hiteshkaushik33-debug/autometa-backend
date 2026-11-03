import 'reflect-metadata';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createApiApp } from '../api/src/bootstrap';
import { InfrastructureService } from '../api/src/infrastructure.service';
import { BillingService } from '../api/src/billing/service';
import { digest } from '../api/src/security/crypto';
import type { Principal } from '../api/src/security/auth.service';
async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('TEST_ONLY');
  const email = process.argv
    .find((x) => x.startsWith('--email='))
    ?.slice(8)
    .trim()
    .toLowerCase();
  if (!email) throw new Error('EXPLICIT_OWNER_EMAIL_REQUIRED');
  const app = await createApiApp();
  await app.init();
  try {
    const db = app.get(InfrastructureService).database;
    const user = await db.user.findUnique({ where: { email } });
    if (!user?.tenantId || user.role !== 'TENANT_ADMIN' || !user.verifiedAt)
      throw new Error('VERIFIED_OWNER_REQUIRED');
    const path = '.local/billing-readiness.json';
    mkdirSync('.local', { recursive: true });
    let state:
      { ownerHash: string; requestId: string; topUpId?: string } | undefined;
    if (existsSync(path)) {
      try {
        state = JSON.parse(readFileSync(path, 'utf8'));
      } catch {
        /* regenerate invalid local diagnostic metadata */
      }
    }
    if (state?.ownerHash !== digest(email))
      state = { ownerHash: digest(email), requestId: randomUUID() };
    writeFileSync(path, JSON.stringify(state), { mode: 0o600 });
    const order = await app
      .get(BillingService)
      .create(
        { ...user, sessionId: 'local-readiness-check' } as Principal,
        'starter',
        state.requestId,
      );
    state.topUpId = order.topUpId;
    writeFileSync(path, JSON.stringify(state), { mode: 0o600 });
    console.log(
      JSON.stringify({
        check: 'razorpay-test-order',
        status: 'ready',
        amountPaise: order.amountPaise,
        currency: order.currency,
        mode: order.mode,
        paymentState: order.status,
        topUpId: order.topUpId,
        message:
          'Use Continue payment in Billing & credits to complete the test checkout. No payment was charged by this check.',
      }),
    );
  } finally {
    await app.close();
  }
}
void main().catch(() => {
  console.error(
    JSON.stringify({
      check: 'razorpay-test-order',
      status: 'failed',
      code: 'CHECK_BILLING_CONFIGURATION_AND_ORDER_HISTORY',
    }),
  );
  process.exitCode = 1;
});
