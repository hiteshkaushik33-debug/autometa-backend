# Prepaid billing verification — 2 November 2026

Approved local test prices: INR 100/500/1,000 top-ups and INR 1 per acknowledgement or follow-up.
The implementation is test-only; it rejects live keys and production billing activation.

## Observed before container deployment

- The prepaid schema migration applied successfully to the local PostgreSQL database.
- Backend type checking and lint passed. Both Next.js frontend builds and lint passed.
- Formatting checks passed in backend, users and admin. The backend build and unit suite passed.
- The isolated billing suite passed server-controlled pricing, idempotent orders, tenant access,
  signature checks, captured-payment requirements, amount matching, raw webhook verification,
  concurrent callback deduplication, trial-to-active conversion, single credit charging, retry
  reuse, failure release, unknown holds, pause/resume at zero balance, concurrent spend protection,
  refund deduplication, dispute blocking and free authentication mail.
- The suite passed again after final account-locking changes, with an expired trial fixture.
  Fixtures and their ledger/payment/webhook records were removed. The suite used mock gateway
  responses and mock email, and generated no real payments or external email.

## Observed after deployment

- Razorpay authenticated the saved test keys and created an unpaid INR 100 order for the
  requested workspace. The gateway response matched the stored receipt, amount and currency.
  That order is visible under Billing & credits with Continue payment. No payment was charged
  and no credits were granted by this connection check.
- Deployed HTTP browser-proxy checks passed billing catalogue/balance access, session-cookie
  transport, secret redaction, cross-origin rejection, inaccessible unowned top-ups, the
  webhook route not being exposed through the user proxy, and the admin billing route.
- The separately running worker paused a priced mock fixture at zero balance, then accepted
  it and recorded exactly one charge after isolated fixture credits were supplied. This did
  not create a real payment or external email. Fixture records were removed afterward.
- The invalid saved MAIL_FROM format discovered at startup was normalized to the authenticated
  Gmail account. The SMTP connection authenticated successfully afterward, without a send.
- Infrastructure smoke checks passed migrations, PostgreSQL/Redis, API health, worker round
  trip and frontend connectivity. The Docker dashboard and updated public documentation are
  served successfully. The public environment template contains no gateway or SMTP secrets.

An unpaid order is not a captured payment and must not be described as a completed purchase.
Hosted checkout requires the user to complete a test payment; no credits may be invented to
stand in for that step. Public Razorpay webhook delivery remains unverified until its HTTPS
endpoint and saved signing secret are configured in the provider dashboard.

See [billing operations](billing.md). Inbound replies, AI/Telegram, live billing, tax invoicing,
uncertain-delivery credit reconciliation and production release checks remain separate work.
