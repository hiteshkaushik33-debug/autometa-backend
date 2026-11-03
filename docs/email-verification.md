# Email-first verification — 2 November 2026

Implemented inside Autometa only. No ecommerce application files were changed. The project
root still contains only admin, backend and users.

## Observed results

- Eight backend unit tests passed: safe local defaults, configuration redaction, password
  hashing, encrypted mail integrity, mock provider, header injection, SMTP error classification
  and sender identity enforcement.
- Backend TypeScript checks passed. Users and admin production builds and lint checks passed.
  Browser visual/interaction QA was unavailable; builds are not a substitute for that review.
- Existing HTTP account regression passed: verification/reset, JWT/refresh rotation and replay,
  tenant ownership, key rotation/revocation, trial expiry, admin suspension/audit and BFF
  HttpOnly cookies, refresh and cross-origin rejection. This ran against mock-mode services.
- Mock external-client integration passed: independent contact-handler HTTP server, 202,
  concurrent idempotency, conflicting payload 409, tenant-scoped receipt access, persistence
  during an API outage, permission evidence, suppression, inactive tenant, expired SENDING
  lease becoming UNKNOWN, daily quota and revoked key rejection.
- Expanded mock integration passed owner email-settings updates, message/attempt inspection,
  cross-tenant message denial and rejection of API keys at dashboard management endpoints.
- Final-image browser-proxy HTTP checks passed Gmail runtime metadata, authenticated settings
  PUT, cross-origin rejection, suppression creation/removal and unavailable-message handling.
  The infrastructure smoke test passed database migration, API/Redis availability, a separate
  worker round trip and frontend-to-backend connectivity. All Compose services are running.
- Isolated mock worker tests passed: two temporary failures followed by acceptance on attempt
  three, recorded attempt history, permanent rejection without retry, ambiguous outcome without
  resend, queue-payload tenant binding, minute-limit delay without consuming an SMTP attempt,
  and quota suppression. Injected failures did not contact an external SMTP server.
- Actual Gmail connection verification and a direct authorized diagnostic email succeeded in
  the earlier provider stage. The queued external-client Gmail test also passed: Gmail returned
  SMTP_ACCEPTED, with one send attempt. Replaying the same accepted event did not create another
  email. Only the recipient explicitly authorized in the conversation was used.

SMTP acceptance is not delivery confirmation. No inbox read, delivery event or inbound reply
tracking is claimed. Temporary fixture tenants, users and messages are removed after tests;
global email usage reservations remain conservative.

## How to repeat safely

From backend:

```sh
npm test
npm run typecheck
npm run lint
docker compose exec -T api npm run test:email
docker compose exec -T api npm run test:email-worker
docker compose exec -T api npm run smtp:verify
```

The two email E2E suites force mock providers and do not send real email. Real-send diagnostics
require an explicitly authorized, allowlisted recipient. The live suite requires Gmail mode
and an explicit recipient: npm run test:email:live -- --to=recipient-you-control@example.com.
Do not run live sends as unattended CI checks. If the API/worker use different provider settings,
pause the ordinary worker during a deliberately isolated provider test to avoid suppressing it.

## Current local use

Gmail is enabled in the saved private backend/.env, with EMAIL_TEST_MODE=true and only the
authorized test address allowlisted. The public .env.example contains placeholders only.
No Gmail credentials are exposed to either frontend. Owners must explicitly enable the email
acknowledgement settings before contact events schedule messages.

Users: http://localhost:3100 (Docker), http://localhost:3000 (direct frontend development).
Developer documentation: /docs. API: http://localhost:4100/api/v1. Admin: http://localhost:3200.
See [integration](integration.md) and [email operations](email.md).

## Dashboard save correction

The email-settings editor originally retained tenantId/updatedAt metadata from the overview
response and sent it back to a strict settings endpoint. The editor now copies and submits
only enabled, enabledEvents, subject, body and dailyLimit. The dashboard also clears a stale
workspace error after a successful reload and offers a connection retry button.

An isolated browser-proxy HTTP check confirmed that extra metadata is rejected, while the
editable payload successfully enables acknowledgements with contact.created and persists
that selection. No real email was sent by this check. Disabled acknowledgements are explained
in the form; previously accepted events retain their original idempotent decision.

## Remaining scope

Inbound Gmail API/IMAP/provider webhooks, secure reply/conversation matching, automated verified
bounce/delivery signals, Telegram/AI, additional follow-up sequences, billing and reporting remain separate
work. Gmail SMTP alone cannot supply these inbound/delivery events.

Hostinger outbound connectivity and actual account limits have not been checked: no authorized
VPS connection was available. Production hardening, operational monitoring, backup/restore,
load testing and a production release review remain. Transactional-provider migration steps
are documented in email.md; no Resend/SES adapter or actual migration is claimed.

## Five-minute follow-up increment

A single follow-up is now scheduled five minutes after acknowledgement acceptance. The local
workspace is enabled; other tenants default to off. The mock integration test passed due-time
checks, duplicate-parent protection, early-job delay, worker restart recovery, owner-scoped
cancellation, disable cancellation, no recursive chain and exclusion of authentication emails.
This verification sent no real email. See follow-ups.md for operation and reply-tracking limits.
