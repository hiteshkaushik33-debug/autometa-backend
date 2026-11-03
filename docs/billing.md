# Prepaid credits and Razorpay test checkout

Implemented as test billing, without a recurring subscription or automatic recharge.
Only Razorpay test payments are available, including under production-built beta containers.
Live keys and real-money billing remain unavailable.

## Test prices approved for local development

- Packs: INR 100, INR 500 and INR 1,000.
- New acknowledgement: INR 1. Its optional follow-up: another INR 1.
- Authentication mail, ordinary mock mail, event acceptance, reads and duplicate requests: free.
- All arithmetic uses integer paise; packs and prices are controlled on the server.
- Daily email rate limits and quotas still apply independently of prepaid credits.

These prices are test configuration, not a production price list or a tax invoice offer.
One INR 100 pack funds 100 email actions, or 50 acknowledgement/follow-up pairs.

## Private environment

Save RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET only in backend/.env. The key ID must have
the rzp_test_ prefix. Only the public checkout key ID is returned to the authenticated browser;
the API secret and webhook secret never leave the backend.

```env
BILLING_ENABLED=true
BILLING_PROVIDER=razorpay_test
BILLING_EMAIL_PRICE_PAISE=100
BILLING_LOW_BALANCE_PAISE=500
BILLING_CHARGE_MOCK_EMAILS=false
RAZORPAY_KEY_ID=your_test_key_id
RAZORPAY_KEY_SECRET=your_test_secret
RAZORPAY_WEBHOOK_SECRET=your_separate_random_webhook_secret
```

A separate random webhook signing secret was generated privately when the local field was
empty. Copy its saved value directly from backend/.env into Razorpay's test webhook settings.
It is not the API key secret. The public .env.example contains placeholders only.

Rebuild and recreate the API/worker/frontends after changing environment or source:

```sh
cd backend
docker compose build api
docker compose up -d --wait --no-build
```

## Local checkout

1. Open http://localhost:3100/dashboard and choose Billing & credits.
2. Select a pack, or Continue payment on an existing unpaid order.
3. Complete Razorpay's TEST checkout using its documented test payment details.
4. The backend verifies the checkout signature using its stored order ID, then fetches
   the payment from Razorpay. Only a matching captured amount/currency/order adds credits.
5. If capture is pending, or the browser closes before verification, use Check status.
   Configure automatic capture in the Razorpay test dashboard for this workflow.

Checkout verification and Check status work from localhost without a public tunnel. Background
gateway webhook delivery requires a separately configured public HTTPS endpoint.

The payment form loads only Razorpay's official checkout script on demand. The platform never
handles or stores card numbers/CVV. Payment history stores only identifiers, amounts and status.

An operator can prepare one unpaid test order for a verified owner:

```sh
docker compose exec -T -e NODE_ENV=test -e EMAIL_TEST_MODE=true api node dist/scripts/billing-ready.js --email=your-owner-address@example.com
```

This diagnostic creates no captured payment and credits no balance. Its private metadata makes
repeat requests idempotent in the same container. Complete the existing order through the UI.

## Webhook setup

Direct API endpoint: POST /api/v1/billing/razorpay/webhook. Select payment.captured, order.paid,
refund.processed and the supported payment.dispute events in the Razorpay TEST dashboard.
Set its secret to the separately saved RAZORPAY_WEBHOOK_SECRET.

For a localhost tunnel, expose only the development webhook proxy:

```sh
cd backend
npm run dev:webhooks
```

The proxy binds 127.0.0.1:4600 and forwards only POST /razorpay to the local API. Point a supported
HTTPS development tunnel at port 4600 and configure https://YOUR-TUNNEL/razorpay in Razorpay.
All other proxy routes are rejected; the API still verifies the raw-body signature. Never put
API keys or secrets in a tunnel URL. The proxy must not be used as a production reverse proxy.

Razorpay does not accept localhost directly and currently restricts several common tunnel
domains. Its documentation describes zrok as a localhost option; check its current accepted
domains before configuring a tunnel. Public webhook registration/delivery cannot be claimed
until a real public endpoint is configured and a Razorpay test event reaches it.

## Credit accounting and paused work

Each new paid email snapshots its price at enqueue time. Authentication and ordinary mock
email have zero cost. Emails accepted before billing rollout are grandfathered at zero; their
follow-up inherits the parent's quoted rate. Tests may charge mock emails only in NODE_ENV=test.

Before SMTP dispatch, a transaction locks the credit account and reserves the quoted cost.
The available balance decreases and the reserved balance increases. Provider acceptance
converts the reservation into one charge. Retries reuse the same hold; replayed jobs cannot
charge again. A known rejection, cancellation, suppression, expiry or exhausted retry releases
the reservation. SMTP acceptance is not proof of final delivery.

Ambiguous SMTP outcomes retain their hold for privileged review. They are neither automatically
resent nor automatically charged/released. Automated review/resolution of uncertain deliveries
is still future operational work; the admin screen identifies reserved balances without granting
an arbitrary balance-edit capability.

At insufficient balance, the email enters WAITING_CREDITS without consuming a send attempt.
It rechecks approximately once per minute and can resume after a verified top-up. Expiry,
tenant status, opt-out, trigger settings, daily quotas and cancellation still apply. The original
contact handler must preserve its own success response. New paid work pauses; authentication,
dashboard access and existing application functionality remain available.

A verified first top-up changes a TRIAL business to ACTIVE, including an expired trial. It
does not reactivate an administratively suspended business. This is prepaid access, not a
recurring subscription renewal. Low balance is reported in the billing screen.

## Refunds and disputes

Refunds initiated in Razorpay are fetched from the gateway and deducted using the cumulative
confirmed amount_refunded. Replayed/out-of-order events cannot deduct the same amount twice.
If credits were already spent, the available balance can become negative; further paid usage
waits until the deficit is covered. This UI does not initiate refunds or promise refund terms.

A verified dispute event blocks the credit account for manual review. Disputes are not
automatically resolved or unblocked. Account review, live pricing, tax invoicing, final refund
terms and chargeback operations must be completed before a production billing release.

## Security and verification

The backend derives tenant ownership from authenticated sessions. Integration API keys cannot
buy credits or access the admin billing screen. Callback signatures use a timing-safe comparison;
webhook HMACs use the exact raw request bytes. Financial mutations lock database rows and use
unique ledger references. Payment-provider API responses are never logged verbatim.

```sh
docker compose exec -T api npm run test:billing
```

The isolated suite uses an in-memory gateway only under NODE_ENV=test and mock email. It
checks fixed server prices, signatures, captured-payment requirements, tenant isolation,
concurrent callbacks, payment/refund deduplication, credit reservation, retry charging,
permanent failure release, unknown holds, zero-balance pause/resume, concurrent spending,
dispute holds and free authentication. No real payment or external email is generated.

Official provider references:

- [Standard checkout integration](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps)
- [Create an order](https://razorpay.com/docs/api/orders/create)
- [Fetch and verify payment state](https://razorpay.com/docs/api/payments/fetch-with-id)
- [Raw signature validation and localhost webhook testing](https://razorpay.com/docs/webhooks/validate-test)
