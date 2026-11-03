# Five-minute local follow-up

The local workspace can send one automated follow-up 300 seconds after its acknowledgement
is accepted by the mock provider or Gmail SMTP. There is no recurring chain. Authentication
mail never schedules a follow-up. Previously accepted acknowledgement emails are not backfilled.

Private backend/.env settings:

```env
EMAIL_FOLLOW_UP_ENABLED=true
EMAIL_FOLLOW_UP_DELAY_SECONDS=300
```

The public template leaves the platform feature off. Owners also control followUpEnabled in
Email automation; acknowledgements and the original event trigger must remain enabled.
The local user's workspace is enabled for the requested test. Other tenants default to off.

Submit a new contact event using the existing integration. No ecommerce code change is needed.
After the acknowledgement is accepted, refresh Email automation to see a FOLLOW_UP row and due
time. The worker must be running; rate limits or downtime can delay sending beyond the due time.
Both acknowledgement and follow-up count separately toward existing sending quotas.

The due time and unique parent-message relationship are stored in PostgreSQL. The follow-up
and its transactional outbox are created with ACK acceptance. BullMQ receives a delayed job;
the worker also checks the stored due time, tenant, permission, suppression, settings, parent
acceptance and provider policy before sending. Replaying a parent cannot create another child.
Failed/uncertain acknowledgements do not schedule follow-ups; follow-ups never schedule children.

Use Cancel follow-up on a pending message, suppress the recipient, or disable follow-ups when
the inquiry is resolved. Disabling the option cancels existing queued/retry follow-ups and does
not restore them when re-enabled. A message already being sent cannot be recalled.

Owner endpoint: POST /api/v1/email/messages/:id/cancel with a dashboard session. It is scoped to
the authenticated tenant and only accepts pending follow-ups. GET /events/:id includes the
follow-up status under its acknowledgement email. External integration keys cannot cancel
messages through the owner endpoint.

Inbound reply tracking is still disabled. Gmail SMTP alone cannot detect replies, final
delivery or reliable bounce events. Replies do not automatically cancel this local follow-up;
use the manual controls until a separate inbound integration is implemented.

Verification: docker compose exec -T api npm run test:follow-up. The isolated test uses mock
email, checks the actual five-minute due time, then advances only its fixture's due time to
exercise dispatch without waiting five minutes. It checks restart recovery, duplicate-parent
protection, early-job delay, tenant-scoped cancellation, disable cancellation, no follow-up
chain and no authentication follow-ups. It sends no real email.
