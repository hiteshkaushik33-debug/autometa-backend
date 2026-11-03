# Available API (email automation)

Prefix: /api/v1. Bodies are strict DTOs validated through Nest pipes. Unknown fields, including
client-supplied tenantId and role, are rejected. All routes include X-Request-ID and safe JSON errors.

## Health

GET /health/live and /health/ready (PostgreSQL and Redis).

## Authentication

- POST /auth/register: email, password (12?128 characters), businessName. Returns 202;
  creates a tenant admin and a server-controlled 14-day trial. Cannot assign SUPER_ADMIN.
- POST /auth/login: email/password. Returns a 15-minute JWT and a 7-day absolute refresh session.
- POST /auth/refresh: refreshToken; atomically rotates hash-only credentials. Reuse revokes the family.
- POST /auth/logout: revokes the authenticated session, invalidating its access JWT.
- GET /auth/me: authenticated identity, including verification status.
- POST /auth/verify-email: single-use token.
- POST /auth/resend-verification: authenticated owner; throttled.
- POST /auth/forgot-password: email; generic response and throttling.
- POST /auth/reset-password: token/new password; consumes once and revokes every existing session.
- GET /auth/development-inbox: authenticated owner's unexpired messages, development/mock mode only.

Verification/reset links use URL fragments so link secrets are not sent in page-request URLs.
The browser submits tokens in JSON only when the user confirms the operation.
Mock messages are encrypted at rest; they are not externally delivered.

Public authentication calls are IP-throttled; login also has an email-specific limit of
10 attempts per 15 minutes. Integration key verification is limited to 60 requests/minute/key.
Additional production throttling/client-IP topology and load testing remain release work.

## Tenant account management

Verified tenant JWT required; tenant is derived from the stored user/session.

- GET /business: own profile, key metadata, audit history and actual active-key count.
- PATCH /business: name, IANA timezone, http(s) website (or empty), description.
- GET /api-keys: own key metadata only.
- POST /api-keys: name/environment; shows the generated secret only in this response.
- POST /api-keys/:id/rotate: name/same environment; atomically revokes old and creates new.
- DELETE /api-keys/:id: revokes an owned key.

At most ten non-revoked keys per tenant, serialized with a PostgreSQL tenant-row lock.
Keys are high-entropy, hash-only, environment scoped, and include prefix/last-used metadata.
The local development API rejects production keys; production rejects development keys.
Suspended/expired trials cannot create keys, update profiles or use integration credentials.
The owner may still sign in and see their account status.

GET /usage authenticates with a server-side API-key Bearer token rather than a dashboard JWT.
It confirms identity/environment and reports event/automation capabilities.

## Super-admin account management

A verified SUPER_ADMIN session is required. Only trusted backend provisioning creates this role.

- GET /admin/overview?search=name: real tenant counts, latest 50 matching profiles with member/key
  counts, timezone distribution and latest 30 audit events.
- PATCH /admin/businesses/:id/status: ACTIVE or SUSPENDED; transactional audit record.

Super-admin has no tenant profile/key endpoint access and cannot read tenant email content through tenant message endpoints.

## Browser transport

Each Next.js app exposes only an allowlisted /api/platform proxy. Session JWT/refresh credentials
are stripped from JSON responses and stored in separate app-namespaced HttpOnly/SameSite=Strict
cookies (Secure and __Host- prefixed in production). Mutations require the configured APP_ORIGIN.
Internal backend URLs and credentials are never embedded into client bundles.
A newly issued integration key is intentionally shown once in its owner's management screen;
it must be copied to the integrating application's server environment.

## Not available yet

General workflow builders, monthly-report APIs, recurring-subscription routes and inbound-email webhooks remain unavailable. Event ingestion and the Razorpay test webhook are implemented below.
Swagger/OpenAPI for the complete business/event API remains part of the integration milestone.

## Email integration

API key: POST /events, /leads and /feedback return 202 with durable receipt, decision and email metadata.
GET /events/:id is tenant/environment scoped. Idempotency-Key is required; conflicts return 409.
See integration.md and the portal /docs for the strict supported payload and permission evidence.

Verified tenant JWT: GET /email/overview; PUT /email/settings; GET /email/messages/:id;
POST /email/suppressions with email; DELETE /email/suppressions/:id. No tenant ID or sender
can be selected by the caller. The BFF permits these routes only in the users portal.
Auth /me also returns provider/test-mode metadata, never SMTP credentials.

Attempt outcomes distinguish mock acceptance, SMTP acceptance, failures, suppression and UNKNOWN.
Inbound events and confirmed delivery are not implemented. See email.md for quota/retry semantics.

## Prepaid test billing

Verified tenant session: GET /billing/overview; POST /billing/topups with packId and requestId UUID;
POST /billing/verify with topUpId, paymentId and signature; POST /billing/topups/:id/reconcile;
GET /billing/topups/:id/checkout. The server controls pack amounts, currency and tenant ownership.
SUPER_ADMIN session: GET /admin/billing exposes balances and test order history without secrets.
POST /billing/razorpay/webhook validates the raw-body HMAC before fetching canonical payment state.
It does not use dashboard JWTs or integration API keys. See billing.md for setup and charge semantics.

GET /usage also returns the authenticated tenant's prepaid balance/status. WAITING_CREDITS is
a paused email state; accepted integration events continue returning HTTP 202.
