# Security boundary

## Foundation controls

Strict TypeScript, Zod server configuration, fail-fast required database/Redis settings,
Nest validation pipeline, 64 KiB body limit, Helmet headers, constrained CORS, correlation IDs,
generic error responses and structured logs that omit URL queries, headers and request bodies.
Configuration errors name only fields. No secrets are sent to client components.
The frontend uses a server-side internal URL and a deadline. Development containers expose
only web/API on loopback; volumes retain PostgreSQL/Redis state. External provider code is absent.

## Required before business endpoints

Hash passwords using Argon2id; secure rotating refresh sessions, revocation, email verification,
password reset and login limits. Reject self-assigned super-admin roles. Verify tenant ownership
in repositories and worker actions. Test two tenants and forged cross-tenant references.
Keys must have high entropy, hash-only storage, prefix metadata, environment scope and rotation.
No NEXT_PUBLIC variable may contain a secret. Do not make a public anonymous email relay.

Validate predefined actions and templates; never execute business payloads or model text.
Entitlements, quotas and consent/legal-basis evidence must be enforced in services, not UI.
Arbitrary emailTransactional=true does not prove consent. Minimize personal data and enforce
retention/deletion. Admin support access requires explicit authorization and auditing.

Use one verified sender. Suppress opted-out/bounced addresses when provider evidence supports it.
Store provider errors as safe codes; redact SMTP AUTH, credentials, tokens and customer content.
Inbound matching must not trust just an email address or subject. Validate provider authenticity,
server-issued routing token, tenant/conversation binding and sender; deduplicate provider IDs.
Ambiguous messages go to review and never mutate an unrelated conversation.

Production needs TLS, CSRF protection for cookie sessions, secure cookies, an allowlist for external
destinations to prevent SSRF, private DB/Redis with authentication, managed secrets, backups,
restore exercises, alerting, vulnerability review and operational audit logs.

## Local HTTPS webhooks

When a signed webhook route exists, use an authenticated HTTPS tunnel to the local API
(e.g. a configured Cloudflare Tunnel). Never expose PostgreSQL, Redis, debug routes or arbitrary
filesystem access. Set PUBLIC_WEBHOOK_BASE_URL in the server environment, register only the exact
provider path and use test credentials. A tunnel does not replace signature/replay verification.
No tunnel is started in milestone 1 because no webhook receiver exists.

## Account/admin increment

Implemented Argon2id, JWT algorithm/issuer/audience checks, database-backed revocation, hashed
refresh credentials with atomic rotation/replay-family revocation, strict role/tenant DTOs,
IP/email throttling, tenant-row locked key caps, environment-specific hash-only keys and
transactional audit records. Super-admin provisioning is a trusted backend operation only.
Browser sessions use app-specific HttpOnly/SameSite=Strict cookies with origin checks and
Secure/__Host- protection in production mode. No token is stored in browser local storage.
Auth links use fragments rather than query strings to avoid request URL logging. Mock auth
mail is encrypted and exposed only to the authenticated owner in development/mock mode.

Production still needs real email, trusted proxy/client-IP configuration, comprehensive
load/abuse limits, TLS and secure deployment review, monitoring, retention cleanup, backups
and restore tests. The shared IP limit is intentionally conservative for local BFF testing.
