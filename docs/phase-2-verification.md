# Authentication and administration increment

Date: 31 October 2026. Scope: milestone 2 and the account/admin portions of milestone 3.
The full automation MVP and production deployment remain incomplete.

## Implemented

- Argon2id password hashing; verified identity, password reset, short-lived JWTs, server-side
  revocation and atomic refresh-token rotation with reuse-family revocation.
- Strict DTOs, IP/email throttling, server-derived tenant context and role checks.
- Tenant registration with a controlled onboarding trial; own profile and API-key management.
- Hash-only keys, one-time secret display, environment separation, atomic key-count cap and rotation.
- Dedicated admin Next.js app: real counts, search/filter, suspend/activate, timezone distribution,
  key/member aggregates and audit history. No fabricated revenue or customer message access.
- User portal: registration/login/verification/reset, profile, keys, own activity and protected mock inbox.
- AES-GCM encrypted mock auth messages; development-owner-only access; fragment-based link secrets.
- Allowlisted server proxies with namespaced HttpOnly cookies, origin checks and automatic refresh.
- Trusted admin provisioning writes generated local credentials to an ignored owner-only file.
- Separate dependency trees, Docker app service and unchanged three-directory top level.
- Initial identity migration, reproducible local environment configuration and local testing guide.

## Verification

Initial source checks and both frontend production builds passed. Four unit tests passed.
The database migration applied successfully. The first real two-tenant account integration run
passed registration/verification/reset, tenant denial cases, hash-only key lifecycle, expired trial,
admin status/audit, refresh replay, BFF cookies/automatic refresh and CSRF.

Final checks after additional cookie namespacing, fragment-link and concurrent-refresh coverage
are recorded below when completed.

## Files and commands

Backend: api/src/security/*, infrastructure module, Prisma schema/identity migration,
packages/web-proxy, config, scripts/admin bootstrap/local configure/dev inbox/account E2E,
crypto tests, Compose/Docker image and CI reference. Admin: complete Next.js console, local
package/lock/configuration and server proxy. Users: public/account pages, business dashboard,
proxy and server environment settings. Documentation: API, security, decisions, plan and test guide.

Checks: lint, typecheck, build and formatting for all three apps; backend npm test;
docker compose build api; docker compose up -d --wait --no-build; infrastructure smoke;
accounts.e2e via real HTTP/PostgreSQL/Redis and both Next.js proxies.
The integration script creates uniquely named fixtures and deletes only those fixtures.

Browser inventory is empty, so interactive browser/screenshot verification was unavailable.
HTTP responses and server-rendered markup are verified; visual QA remains outstanding.
Hosted CI has not been run; its nested YAML remains a reference under the user's root constraint.

## Remaining

Marketing/legal completeness, contacts/leads/feedback UI and records, events/workflows/outbox,
Gmail SMTP and separate inbound replies, Telegram/AI, follow-ups, subscriptions/payments,
usage quotas/reports, deployment hardening, monitoring, restore/rollback and Hostinger checks.
Do not treat this increment as a production-ready automation platform.

## Final observed results

All three applications passed lint, strict type checking, production builds and formatting.
All four backend unit tests passed. The final container image built and Compose startup
completed with healthy API, both portals, PostgreSQL and Redis; worker round trip passed.
The identity migration applied successfully. Expanded account integration passed, including
concurrent refresh-family revocation, development/production key separation, token-link
fragments, key rotation/revocation/ownership, password-reset replay and global session
revocation, trial expiry, admin suspension/audit and both browser server proxies/CSRF.

Provisioned a single real local super-admin using the trusted command; its randomly generated
credentials are stored only in ignored backend/.local/admin-credentials.txt and not in this
report. Verified its login, admin overview and logout through http://localhost:3200.
Both public app URLs and API health returned 200. No fake business records were left behind;
E2E fixtures were removed. Hidden-inclusive root assertion passed with exactly three
directories: admin, backend and users.

The stack is left running for manual testing. Follow local-testing.md to register and verify
a business account. No live SMTP/provider, payment, production deployment or visual browser
verification is claimed.
