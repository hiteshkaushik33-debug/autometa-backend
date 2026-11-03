# Integrate an existing website

Working public guide: http://localhost:3100/docs (or port 3000 for the directly run users app).
It contains copyable server-side examples for Node.js, NestJS, Next.js, PHP and cURL.
POST /api/v1/events, /leads and /feedback are implemented and return HTTP 202.
GET /api/v1/events/:id returns an API-key-scoped receipt.

## Minimal change to your current handler

Keep the original database, validation, authentication, frontend and success response.
Create a development key in Autometa, then enable acknowledgements in Email automation.
Add AUTOMATION_API_BASE_URL=http://localhost:4100/api/v1 and AUTOMATION_API_KEY to your
existing application's private server environment. Production uses a separate HTTPS URL/key.

Copy [autometa.mjs](../examples/external-client/autometa.mjs) into your own server code only
if you choose to integrate it. This development task has not changed another application.

After the original successful save, map the existing saved record into this payload:

```js
await notifyAutometa({
  event: 'contact.created',
  externalEventId: String(savedContact.id),
  contact: { name: savedContact.name, email: savedContact.email },
  data: { source: 'ecommerce-contact', message: savedContact.message },
  communicationPreferences: {
    emailTransactional: customerRequestedAcknowledgement === true,
    emailMarketing: false,
  },
  communicationEvidence: {
    basis: 'customer_request',
    source: 'ecommerce-contact-form',
    reference: String(savedContact.id),
    occurredAt: originalSubmissionTimeISO,
  },
});
// Return your existing contact-handler success response regardless of this result.
```

These are mapped variables, not a required database schema. Use your existing record ID and
original ISO submission time; do not generate a different time/payload on each retry.
Permission evidence must describe the real customer request. A flag alone is insufficient.
No marketing campaign or arbitrary sender is supported.

Supported events: contact.created, lead.created, inquiry.received, feedback.submitted.
The /leads and /feedback aliases omit event and choose lead.created/feedback.submitted.
Requests reject extra fields such as tenantId; the API key determines the tenant.

## Reliability

The helper has a three-second timeout, rejects redirects and returns accepted:false on errors.
A failed automation request must never undo the successful ecommerce operation. Do not make
the network request inside an open database transaction, or detach an unawaited serverless fetch.
For guaranteed eventual forwarding, use an existing durable application queue/outbox.

Send Idempotency-Key of 8-128 letters, digits, periods, colons, underscores or hyphens.
The sample uses contact: plus the stable external ID. Same tenant/environment/identity and
payload returns the original event. A changed payload under the same key/external ID returns 409. Keep the original timestamp, ID, key and full payload on retry.

HTTP 202 means durable event acceptance. Inspect decision and email fields: disabled triggers,
missing permission or suppressed recipients can produce no email. Gmail test mode permits only
the configured allowlist. SMTP_ACCEPTED does not confirm delivery. Poll GET /events/:id or inspect
Email automation for attempts/status. Default mock email never reaches a real mailbox.

## Local sample-client test

```sh
cd backend
docker compose exec -T api npm run test:email
```

The test forces its isolated API into mock mode, starts an independent HTTP contact handler,
and uses the same helper. It checks 202, concurrent idempotency, conflicts, tenant isolation,
permission, suppressions, quotas, uncertain-send recovery and persistence during an API outage.
Fixture records are removed afterward. It does not touch an ecommerce project's files.

For Docker clients, localhost is container-local. Use a shared network's API service or Docker
Desktop's host.docker.internal and the published API port. Never expose API keys in browser code.
Outbound integration does not need a public tunnel. Inbound webhooks remain disabled; an HTTPS
tunnel will be used only with a separately implemented authenticated provider callback.
