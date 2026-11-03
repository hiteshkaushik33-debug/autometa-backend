# Outbound email automation

Implemented and tested locally on 2 November 2026. See [verification](email-verification.md).
Inbound reply tracking and VPS verification remain separate work.

## Configure privately

Save credentials in backend/.env, never .env.example. The example file is a public template.
MAIL_PROVIDER is mock or gmail. Required Gmail fields:

- SMTP_HOST=smtp.gmail.com
- SMTP_PORT=465 and SMTP_SECURE=true (or 587 and false with required STARTTLS)
- SMTP_USER=your authenticated Gmail account
- SMTP_APP_PASSWORD=your Google App Password
- MAIL_FROM=the exact same plain email address as SMTP_USER

Only one authenticated platform sender is supported. Display-name From syntax and arbitrary
tenant From addresses are rejected. TLS certificate validation stays enabled.
Do not paste credentials into chat or browser code.

EMAIL_TEST_MODE=true is required outside production. EMAIL_TEST_RECIPIENTS is a comma-separated
list of explicitly authorized addresses. Gmail messages to other addresses are SUPPRESSED.
Mock accepts local fixtures without a network send. The current saved local configuration uses
Gmail and restricts real sends to the authorized test recipient.

After changing the environment, recreate API and worker:

```sh
docker compose up -d --force-recreate api worker
docker compose exec -T api npm run smtp:verify
# Diagnostic real send: run only for an authorized recipient.
docker compose exec -T api npm run smtp:test -- recipient-you-control@example.com
```

smtp:verify opens an authenticated SMTP connection without sending. smtp:test sends a direct
diagnostic email; application/authentication emails use the durable queue and attempt ledger.
Do not run real-send commands automatically during CI.

## Application dispatch

The provider-independent EmailService delegates to MockEmailProvider or GmailSmtpProvider.
The enqueueEmail service applies recipient restrictions and writes an encrypted message plus
transactional outbox. Authentication verification/reset mail uses the same queue.
Mock authentication also writes the protected, encrypted, expiring development inbox.

The separate BullMQ worker publishes unpublished outbox rows using recoverable claims and a
deterministic email UUID as jobId. Job payloads contain IDs only. Dispatch locks the email row
and checks its tenant, trial, settings, permission, suppression, expiry, provider and sender.
Provider mode is snapshotted: a mock message never becomes a real send after switching Gmail on.
A Gmail message is suppressed if the worker has a conflicting sender/provider configuration.

Global and tenant per-minute Redis limits are atomic. Default limits are 10 and 5 respectively.
Messages delayed by rate limiting do not consume SMTP retry attempts. Unique-message daily
quotas default to 100 globally and 20 per tenant, with a lower owner-configured cap allowed.
Counters use UTC days and separate mock/Gmail ledgers. A unique message reserves once; retries
reuse its reservation. Rejected/uncertain attempts keep reservations conservatively.
Quota exhaustion suppresses the message, rather than unexpectedly sending it tomorrow.

Definite transient SMTP failures retry at most five times with exponential backoff starting
at two seconds. Authentication/permanent SMTP rejections do not retry. Each send attempt records
its number, timestamps, outcome and safe code. Credentials/raw provider responses are never logged.

SENDING is persisted before the external call. A network failure with an uncertain SMTP outcome,
crash after send, or expired dispatch lease becomes UNKNOWN. UNKNOWN is never automatically
resent. This deliberately favors duplicate prevention over guaranteed delivery; an SMTP
Message-ID alone cannot guarantee exactly-once delivery.

Statuses: QUEUED, SENDING, RETRY, MOCK_ACCEPTED, SMTP_ACCEPTED, SUPPRESSED, FAILED, UNKNOWN.
SMTP_ACCEPTED means Gmail accepted a submission, not confirmed delivery.

## Suppression and inbound limitations

Owners can suppress recipient addresses per tenant. The worker rechecks suppression before
each acknowledgement. Removing suppression affects only future eligible events. It does not
resend prior messages. Permanent SMTP rejections are logged as failed attempts; generic SMTP
errors are not treated as reliable bounce or complaint signals.

Gmail SMTP provides neither inbound reply events nor reliable bounce webhooks or final delivery
confirmation. Inbound processing remains disabled. A separate Gmail API/IMAP or signed provider
webhook adapter must deduplicate message IDs and securely bind a server-issued conversation
token, tenant, expected sender and In-Reply-To/References. Subject-only matching is insufficient.

## Hostinger KVM deployment checks (not yet performed)

Run these from the actual VPS, without placing passwords in command-line arguments:

```sh
# TLS reachability diagnostics; they do not authenticate or send.
openssl s_client -connect smtp.gmail.com:465 -servername smtp.gmail.com -brief
openssl s_client -starttls smtp -connect smtp.gmail.com:587 -servername smtp.gmail.com -brief

# With the platform environment configured privately on that VPS:
docker compose exec -T api npm run smtp:verify
# Then send one explicitly authorized test and inspect its actual queue attempt.
```

Verify outbound firewall/provider restrictions, account-specific Google sending limits and usage,
clock accuracy, TLS, persistent database/Redis storage, backups, secrets and monitoring.
Configured quotas are conservative platform caps; they do not override Google account limits.
Record actual evidence before deploying. This workspace has no authorized VPS session.

## Migrate later to Resend or Amazon SES

1. Add an EmailProvider adapter returning provider acceptance and a provider message ID. Keep
   Gmail/mock adapters and safe permanent/transient/ambiguous error classification.
2. Verify the platform sender/domain and required DNS authentication. Complete provider account,
   sending-authorization and sandbox requirements; configure credentials privately.
3. Add provider-specific configuration validation. Only then extend the MAIL_PROVIDER enum/UI.
4. Pause sends and drain or review in-flight Gmail messages. Never convert UNKNOWN into a resend.
   Pending rows keep their provider snapshot; explicitly reconcile them before switching.
5. Add signed, timestamp-checked, replay-safe delivery/bounce/complaint webhooks. Match a provider
   message ID to its stored tenant/message; only verified evidence changes delivery/suppression.
6. Test tenant isolation, duplicate callbacks, retries, quotas, suppression and a controlled canary.
7. Resume sending, monitor provider acceptance and delivery separately, and retain a documented
   rollback. Preserve message IDs, attempts, audit history and usage accounting.

No inbound/delivery webhook or production provider switch is claimed by the current Gmail adapter.
