# Autometa backend and local infrastructure

Prepaid Razorpay test billing is documented in [billing.md](docs/billing.md).
Users manage top-ups and usage under Billing & credits; admin billing is read-only.

All project content is contained in the three top-level folders: admin, backend and users.
This folder owns the API, worker, database/configuration/shared-type packages, dependencies,
environment settings, Docker Compose, documentation, tests and tooling.

## Commands

Run backend commands from this folder:

```sh
cd backend
npm ci
npm run db:generate
npm run lint
npm run typecheck
npm test
npm run format:check
npm run build
```

The frontend is independent: run npm ci, npm run lint, npm run typecheck and npm run build
from ../users. Each folder has its own package.json, lockfile and node_modules.
The admin console is an independent Next.js app in ../admin with its own dependency tree.

## Start the entire local stack

From this folder, run npm run dev:configure to create the local environment and signing secret, then:

```sh
docker compose build api backups
docker compose up -d --wait --no-build
docker compose exec -T -e API_BASE_URL=http://api:4000/api/v1 -e WEB_ORIGIN=http://web:3000 api npm run test:integration
```

The existing local .env uses frontend http://localhost:3100 and API
http://localhost:4100/api/v1/health/ready to avoid other applications' ports.
The example defaults to 3000/4000; configure WEB_PUBLISHED_PORT/API_PUBLISHED_PORT and
WEB_ORIGIN/API_BASE_URL together when changing published URLs.
Container ports remain 3000/4000. PostgreSQL and Redis are private and persistent.

Compose uses the parent directory as build context and this folder's Dockerfile at
infrastructure/docker/Dockerfile. Its Dockerfile-specific ignore file excludes all
node_modules, build output and secrets across both application folders.
API, worker and migration run in /app/backend; frontend runs in /app/users with its own dependencies.
The Compose project name and data volumes are unchanged.

Use docker compose down to stop this project without deleting data.
Use docker compose logs --tail 100 api worker to inspect service logs.

## Host development

Start dependency containers with:

```sh
docker compose -f docker-compose.yml -f docker-compose.host.yml up -d postgres redis
npm run db:generate
npm run db:migrate
```

Run npm run dev:api and npm run dev:worker in separate terminals here.
Start the frontend separately from ../users (see its README).
Do not start duplicate host processes on ports already occupied by Compose.
npm run dev:web remains a convenience alias for starting the sibling frontend.

## Layout

- api/: NestJS API, validation, request IDs, safe errors and health routes.
- worker/: separate BullMQ processor.
- packages/database/: sole Prisma schema and migration history.
- packages/config/: server-only validated environment settings.
- packages/shared-types/: non-secret contracts shared with the frontend.
- scripts/, tests/: infrastructure smoke test and configuration tests.
- infrastructure/docker/: container image and build-context exclusions.
- .github/workflows/ci.yml: CI reference definition. GitHub discovers workflows only in
  a repository-root .github folder; this nested definition is retained as a template
  to respect the requested three-folder top level.
- docs/: original brief, amendments, architecture, development plan and verification history.

Authentication, tenant onboarding, API-key management and platform administration are implemented.
Start testing with [the local testing guide](docs/local-testing.md). Admin URL: http://localhost:3200.
Queued email automation and Razorpay test credits are implemented. Public deployment preparation
is covered by [production beta operations](docs/production-beta.md); older verification documents
record earlier increments.

See [phase 2 verification](docs/phase-2-verification.md) for the account/admin increment.

## Email automation

Contact-event acknowledgements now support mock and Gmail SMTP with a durable BullMQ queue.
Start at the users portal /docs and Email automation dashboard. See [integration](docs/integration.md),
[email configuration](docs/email.md) and [verification](docs/email-verification.md).
The production beta accepts each customer's validated recipient; the optional development
override enables the test-recipient allowlist. Run the mock external-client checks only in
the isolated test/development setup described in the email verification guide.
Inbound tracking, additional channels and production deployment checks remain separate.

## Production beta operations

Docker now defaults to production builds and compiled Node entry points. Run npm run ops:configure,
then docker compose build api backups and docker compose up -d --wait --no-build.
See [production-beta.md](docs/production-beta.md) for encrypted backups, isolated restore checks,
monitoring at localhost:9090, test billing and dynamic multi-user recipients.
The optional docker-compose.dev.yml restores development servers and recipient restrictions.
See [operations verification](docs/operations-verification.md) for the actual restore and runtime results.
