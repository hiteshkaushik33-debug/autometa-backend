# Local integration and Gmail SMTP amendment

This amendment supplements docs/project-brief.md. The immediate task remains milestone 1 only.

## Local integration acceptance

- Fully local Docker Compose: Next.js, NestJS, PostgreSQL, Redis and separate BullMQ worker.
- Environment-configurable development/production API URLs and development API keys.
- Server-side copy-paste Node.js, NestJS, Next.js, PHP and cURL documentation.
- Existing application keeps its database, authentication, design and business logic.
  Integration is a small server-side call after an existing contact/lead/feedback operation.
- No secret API keys in browser code.
- Request idempotency, asynchronous 202 processing, deadlines and safe error handling.
- Mock email, Telegram and AI providers for local testing.
- E2E test with a standalone external client, including service-outage behavior.
- Signed webhook testing over a secure HTTPS development tunnel when required.
- Existing application remains functional when automation is unavailable.

## Email acceptance

Use Nodemailer Gmail SMTP initially, behind a provider abstraction replaceable by Resend/SES.
Variables: MAIL_PROVIDER, SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER,
SMTP_APP_PASSWORD, MAIL_FROM.

Implement connection verification, test sending, outbound queue, tenant/global rate limits,
exponential backoff, duplicate prevention, attempt logs, quota accounting, sender validation,
secret redaction and safe errors. Support suppression/bounces only to the extent supported
by authenticated provider evidence. Initially use one verified platform sender and prohibit
tenant-controlled arbitrary From identities.

Inbound must be separate supported Gmail API/IMAP processing or authenticated provider webhooks,
with secure message-to-conversation matching. SMTP alone does not provide inbound events,
delivered-message confirmation or reliable bounce webhooks.

## Required order

1. Provider-independent EmailService.
2. Mock email provider.
3. Gmail SMTP provider.
4. Local SMTP connection test.
5. Actual authorized outbound test.
6. BullMQ processing and rate limits.
7. Separate inbound/reply processing.
8. Existing sample application integration test.
9. Hostinger KVM outbound SMTP connectivity and limits verification.
10. Document migration to a dedicated transactional provider.

Do not modify unrelated applications. Live credentials, recipient authorization and VPS
access are unresolved; do not claim those checks passed.
