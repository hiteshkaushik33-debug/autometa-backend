# Email-first integration increment

Priority approved by the user: complete contact-form acknowledgement email before Telegram.
Do not read, change or delete files in the ecommerce project. Ship a small server-side helper
and copy-paste integration instructions inside this platform only.

Development order: provider-independent service -> mock -> Gmail SMTP -> verify connection ->
one authorized outbound test -> durable event/outbox + BullMQ/rate limits -> external-client
integration tests. Inbound/reply tracking and Hostinger checks remain separately identified.

An explicit real test recipient was authorized in the conversation. Local Gmail mode must restrict
recipients to an explicit allowlist. Never print SMTP credentials or send to real customers.
Use one platform sender matching the authenticated Gmail identity.

Acceptance: tenant-authenticated events/leads/feedback return 202, transactional persistence/
outbox, stable idempotency/conflict detection, contact records, opt-in acknowledgement settings,
sending quotas, per-tenant/global rate limits, bounded retries, attempt logs, mock inbox,
SMTP-accepted (not delivered) status, suppression and conservative UNKNOWN handling for
ambiguous SMTP outcomes. Existing client work must succeed during automation outages.
