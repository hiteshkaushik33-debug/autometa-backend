# Implementation checklist

Current completed increment: accounts/admin plus event-driven outbound acknowledgement email.
See email-verification.md for tests observed on 2 November 2026.
The user authorized advancing on 31 October 2026. See phase-2-verification.md.
Checkboxes denote implemented work; full verification is reported separately.

## 1. Repository and architecture

- [x] Inspect empty workspace and installed toolchain.
- [x] Define modular monolith, module boundaries and schema outline.
- [x] Configure npm workspaces and strict TypeScript.
- [x] Set up Next.js, NestJS, Prisma/PostgreSQL, Redis/BullMQ worker.
- [x] Commit initial schema/migration and validated server configuration.
- [x] Add Docker development environment, lint/format/tests and CI definition.
- [x] Document API contract, security, decisions, integration and email plan.
- [x] Pass every runtime/build/check acceptance condition (see verification report).
- [x] User authorized the next phase after reviewing the foundation.

## 2. Authentication and tenancy

- [x] Registration, email verification, Argon2id, secure sessions, refresh rotation/revocation.
- [x] Tenant onboarding, RBAC, backend-only super-admin provisioning.
- [x] Generate/revoke/rotate environment-specific hash-only API keys and usage metadata.
- [x] Identity migration and two-tenant account/key ownership tests; system worker smoke still passes.
- [ ] Tenant isolation tests for future business-action workers and customer records.

## 3. Public pages and dashboards

- [x] Animated sci-fi public landing and /docs guide with five server-side example stacks.

- [x] Authentication pages, responsive admin/business account UI and current API documentation.
- [ ] Full marketing/legal content and complete integration API reference.
- [x] Real API-backed admin and tenant account views, profile settings, API keys and audit history.
- [ ] Contacts/leads management, workflows, billing and reporting views.
- [x] Loading/error/empty states and labeled keyboard-accessible forms implemented.
- [ ] Interactive browser, visual and full accessibility verification (no browser available).

## 4. Events and workflows

- [x] Event DTO validation, ingestion limits and customer-request permission evidence.
- [ ] Paid-plan event entitlements.
- [x] Canonical idempotency, external event deduplication and durable transactional outbox.
- [x] 202 ingestion, contacts/leads/feedback and tenant-scoped queries.
- [ ] Predefined workflow actions, execution history, retries and scheduled follow-ups.

## 5. Email, AI and Telegram (amended order)

- [x] Provider-independent EmailService and mock email adapter first.
- [x] Nodemailer Gmail adapter, sender validation and secret-safe errors.
- [x] Verify SMTP locally; then send one actual email to an authorized test recipient.
- [x] BullMQ email queue, tenant/global rate limits, quotas, attempt logs and deduplication.
- [ ] Separate Gmail API/IMAP or authenticated webhook inbound integration.
- [ ] Secure conversation matching, reply/opt-out cancellation, suppression where supported.
- [ ] Mock Telegram and AI, then real adapters, approved knowledge and human review fallback.
- [x] Standalone sample client integration and outage preservation tests.
- [ ] Verify Hostinger KVM outbound SMTP connectivity and configured account limits.
- [x] Dedicated transactional-provider migration documentation.
- [ ] Actual transactional-provider migration verification.

## 6. Subscription and reporting

- [ ] Versioned plan entitlements, Razorpay sandbox, signed idempotent webhooks.
- [ ] Payment transitions, atomic usage limits, subscriptions/cancellation.
- [ ] Aggregate analytics, monthly report generation/delivery with deduplication.

## 7. Production readiness

- [ ] Full E2E journey, tenant security, load/queue recovery and provider failure tests.
- [ ] Hostinger deployment: hardened images, Nginx/TLS, secrets and private networking.
- [ ] Monitoring, backups and tested restore/rollback.
- [ ] No fake production features; complete MVP acceptance review and handover.
