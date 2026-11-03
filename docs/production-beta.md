# Production builds and beta operations

The default Compose stack runs compiled NestJS/BullMQ services and prebuilt Next.js applications.
The application container runs as the non-root node user. The frontend containers receive only
their API/origin configuration, not Gmail, Razorpay, encryption or monitoring secrets.
PostgreSQL/Redis remain private, and existing autometa data volumes are preserved.

## Build and start

For a VPS that contains only the backend folder (for example /var/www/autometa-backend),
use the backend build override. It needs no sibling users/admin sources and preserves
the same database volumes and service names:

```sh
docker compose -f docker-compose.yml -f docker-compose.backend.yml build api backups
docker compose -f docker-compose.yml -f docker-compose.backend.yml up -d --wait --no-build api worker backups monitoring
docker compose -f docker-compose.yml -f docker-compose.backend.yml ps
```

Use both files for subsequent backend updates. The override changes the API/migration/worker
image to autometa-backend:local and builds from the backend folder itself. It does not start
the frontend services; specify the backend targets shown above. The existing frontend
availability rules assume local web/admin containers; configure frontend monitoring for the
separate hosting destination before relying on those two alerts. API, worker and backup
monitoring work independently.

From backend, with the existing private .env saved:

```sh
npm ci
npm run ops:configure
docker compose build api backups
docker compose up -d --wait --no-build
docker compose ps
```

For a fresh installation, npm run dev:configure also generates the initial signing secret and
calls ops:configure. Existing signing keys, database passwords and provider credentials are
preserved. ops:configure generates missing backup/monitoring secrets; it does not print them.

Local URLs stay users :3100, admin :3200, API :4100. Monitoring is http://localhost:9090.
Published ports bind loopback. Set your public WEB_ORIGIN/ADMIN_ORIGIN/API_BASE_URL and put an
HTTPS reverse proxy in front before public VPS access. HTTPS is needed for secure public
session cookies. After switching from development cookies, sign in again.

The current local database uses the development template password. Use a unique private
POSTGRES_PASSWORD for a fresh VPS database. For an existing database volume, changing .env
alone does not rotate the PostgreSQL role password: coordinate the role-password change
with the matching application/backup configuration before restarting services.

Docker uses NODE_ENV=production. API_KEY_ENVIRONMENT is independent: development is retained
for the current beta so existing ecommerce development keys continue working. Set production
explicitly when you intend to require production integration keys. This does not change payment
mode: only Razorpay test keys/payments are supported, including under production builds.
All checkout screens continue displaying test mode; virtual credits are not real money.

Optional development commands:

```sh
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

That override uses development servers and restores the recipient allowlist. Host development
must likewise set EMAIL_TEST_MODE=true, or use mock email. Integration test scripts must run in
a test/development process with EMAIL_TEST_MODE=true; they are not public production endpoints.

## Multiple users and recipients

Production beta uses EMAIL_TEST_MODE=false. Every contact's validated email address comes from
the tenant-authenticated event payload; signup/reset mail uses the account's email. There is no
single fixed recipient. Each tenant keeps its own contacts, permissions, suppressions, templates,
credit balance and sending limits. API keys cannot select another tenant.

MAIL_FROM remains the single platform sender matching SMTP_USER. This change does not allow
arbitrary tenant From addresses. Gmail TLS remains port 465 (or supported STARTTLS on 587).
Run the connection check on the actual Hostinger VPS after deployment:

```sh
docker compose exec -T api node dist/scripts/smtp-check.js
```

The localhost connection check cannot establish the VPS's actual network/account behavior.
Changing the recipient mode does not bypass customer-request permission, opted-out recipients,
credits or global/per-tenant quotas. The current five-minute follow-up delay is unchanged.

## Encrypted database backups

The backups service starts a backup immediately, then daily. It retains the latest 14 complete
copies and runs an isolated restore drill weekly. Manual backups count toward that retention.
The interval/count are configurable through BACKUP_INTERVAL_SECONDS/BACKUP_RETENTION_COUNT.

Archives and manifests live in backend/.local/backups. Status metadata lives separately in
.local/backup-status and is mounted read-only into the API for monitoring. Both folders are
excluded from Git and Docker build contexts. No database password appears in a command line.

pg_dump produces a consistent custom-format database archive. It is streamed through
AES-256-GCM encryption before persistence. SHA-256 and GCM authentication are checked before
pg_restore can consume a decrypted archive. Decryption uses a private temporary file on tmpfs;
no plaintext archive is retained in the backup directory.

Keep BACKUP_ENCRYPTION_KEY and AUTH_JWT_SECRET in a separate recovery secret store. The first
decrypts archives; the second is needed for existing encrypted application messages. Retain
old keys for as long as their backups are retained. Neither belongs in Git or in public URLs.

```sh
# New encrypted backup, without stopping the application:
docker compose run --rm --no-deps backups once

# Restore the newest backup into a unique temporary database, verify and remove it:
docker compose run --rm --no-deps backups verify

# Select a retained archive explicitly:
docker compose run --rm --no-deps backups verify --file=YOUR_BACKUP_FILENAME.enc
```

The drill checks migration history, financial ledger/reservation consistency, database
constraints and preservation of an existing encrypted email fingerprint. It never points the
working API at the restored database, and no email or payment is executed by the restore tool.

Local backups share the VPS failure domain. An off-site destination is not configured in this
workspace. Copy the encrypted .enc files AND their .json manifests to independent storage, and
keep their key separately. For example, after configuring SSH storage on a Linux VPS:

```sh
sudo rsync -av --ignore-existing .local/backups/ BACKUP_USER@BACKUP_HOST:/srv/autometa-backups/
```

Configure and test that destination before relying on recovery from loss of the VPS itself.
Daily dumps have an RPO of approximately 24 hours; they are not continuous point-in-time recovery.

## Recovery without overwriting the working database

The recovery command creates a NEW database only. Its name must start autometa_recovered_
and have an 8-32 character hexadecimal suffix. It refuses the current database name and any
existing target. Example:

```sh
docker compose run --rm --no-deps backups recover --target=autometa_recovered_20261103
```

Recovered pending sends are quarantined as UNKNOWN/RESTORE_REVIEW_REQUIRED, unpublished outbox
records are disabled and restored sessions are revoked. This prevents automatic email replays
from an older snapshot. Held credits remain for review. The isolated verify drill does not
quarantine data because its temporary database is never activated.

Before activation, pause API/worker, reconcile gateway/payment history and external sends that
occurred after the snapshot, verify the recovered database, then deliberately change POSTGRES_DB
to that new name and restart/migrate the app. Keep the original database available for rollback.
Do not enable real customer processing against unreconciled restored billing/email state.
The tool does not overwrite/drop the working database or automatically perform this cutover.

## Monitoring

Prometheus scrapes an authenticated aggregate endpoint every 15 seconds. Worker heartbeats
expire after 30 seconds and Docker health checks inspect each worker's own heartbeat.
Metrics include API/frontend/worker availability, email status totals, old unpublished outbox
age, blocked billing accounts, latest backup result and latest restore-drill success.
No tenant names, email addresses, message bodies, balances or credentials are exported.

Open http://localhost:9090/alerts and /targets. Rules cover API/worker/frontend outages,
stuck outboxes, backup failure/staleness, stale restore checks and uncertain email outcomes.
Monitoring data persists for 15 days. Port 9090 is loopback-only; use authenticated access
or an SSH tunnel if viewing remotely. The metrics bearer token is in private .env and the
readable container secret under the private .local/monitoring directory.

Alert rules are local at this stage. No email/Slack/Telegram notification receiver has been
configured. Connect an Alertmanager receiver or an independent uptime monitor for unattended
notifications; do not treat a local alerts page as a notification service.

## Publishing the repository

See [git-push.md](git-push.md). Git metadata can live inside backend so the workspace root
continues containing only admin, backend and users. No repository has been initialized,
committed or pushed on your behalf, and no Git account token has been requested.
