# Local account and admin testing

The current increment implements authentication, tenant onboarding, API-key management and
platform account administration, event ingestion and queued email acknowledgements. See email.md.

## Start

Install dependencies separately in backend, users and admin using npm ci.
Run these commands from backend (PowerShell may require npm.cmd):

```sh
npm run dev:configure
docker compose build api backups
docker compose up -d --wait --no-build
docker compose exec -T api npm run admin:bootstrap
docker compose cp api:/app/backend/.local/admin-credentials.txt .local/admin-credentials.txt
```

dev:configure creates backend/.env if needed and generates a strong signing/encryption secret,
without replacing an existing secret. Keep .env private. Set published ports/origins before
startup if the defaults are occupied. Current local URLs:

- User portal: http://localhost:3100
- Admin console: http://localhost:3200
- API: http://localhost:4100/api/v1

Credentials for the generated super-admin are in backend/.local/admin-credentials.txt.
They are random, never committed and never embedded in frontend code. Bootstrap never promotes
an existing business account or silently resets a password. Preserve the local credentials file
when rebuilding containers; the admin account persists in PostgreSQL. If it already exists,
bootstrap reports that and leaves it unchanged.

For non-development provisioning supply SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD through a
trusted server environment; no default admin password exists. Production is not ready yet.

## Test the user journey

1. Open the user portal and create a business account. Use a password of at least 12 characters.
2. Registration signs in to the dashboard, which requires email verification before business access.
3. Open the local test inbox and follow the verification link, then click Verify email.
   Messages are mocked, encrypted at rest and visible only to their authenticated owner.
   They expire after 30 minutes. With MAIL_PROVIDER=gmail, verification/reset mail is queued to the configured recipient allowlist instead.
4. Return to the dashboard. Edit business name, website, description and IANA timezone.
5. Create a development API key. Copy it immediately; later lists show only prefix/metadata.
6. From a server/terminal call GET /api/v1/usage with Authorization: Bearer YOUR_KEY.
   The response confirms identity/environment. Enable Email automation and submit an event as documented at /docs.
   Production keys cannot authenticate the development API.
7. Rotate or revoke a key; the old secret must stop working.
8. Sign in to the admin console. Search the business, suspend it, and verify its integration
   requests and new key creation are blocked. Reactivate it and check audit history.
9. Create a second business in a separate browser profile/private window and verify isolation.
10. Test logout, forgot/reset password and expired/replayed verification links.

If you cannot sign in, retrieve a mock reset email only through the trusted local CLI:

```sh
docker compose exec -T api npm run dev:inbox -- your-account@example.test
```

This prints private links to your terminal. The CLI is disabled outside development/mock mode.
No public mailbox endpoint accepts arbitrary recipient identities.

## Automated checks

From backend:

```sh
npm run lint
npm run typecheck
npm test
npm run build
docker compose exec -T -e API_BASE_URL=http://api:4000/api/v1 -e WEB_ORIGIN=http://web:3000 api npm run test:integration
docker compose exec -T -e API_BASE_URL=http://api:4000/api/v1 -e TEST_USERS_URL=http://web:3000 -e TEST_ADMIN_URL=http://admin:3000 api npm run test:accounts
```

Account tests require development/mock mode, create uniquely named fixture accounts and a
trusted test admin, test actual HTTP endpoints and delete only their own fixtures afterwards.
BFF tests send the configured public origin while connecting over the container network.

From users and admin independently: npm run lint, npm run typecheck, npm run build,
npm run format:check. See the phase verification report for actual observed results.

## Remaining before full local MVP testing and deployment

Separate inbound replies, Telegram/AI, scheduled follow-ups, billing, monthly reports and
production operational checks remain. Contact acknowledgements, event/outbox processing,
Gmail/mock sending and email quotas are implemented; see email-verification.md.
Do not deploy this increment as a complete commercial automation service.

## Email-first testing

Use docker compose exec -T api npm run test:email for isolated mock integration tests.
The current saved local environment uses Gmail with a recipient allowlist. The older
account regression suite expects a fully mock API and frontend environment; do not run
it against Gmail and mistake suppressed fixture messages for broken authentication.
See email.md for SMTP verification, authorized diagnostic sends and deployment checks.
