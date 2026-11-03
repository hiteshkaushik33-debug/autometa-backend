# Milestone 1 verification

Date: 30 October 2026. **Foundation implemented and functional acceptance checks passed.**
Milestone 2 has not started. Visual browser inspection was unavailable (browser inventory empty).
This is development infrastructure, not a production-ready SaaS or complete MVP.

## Implemented architecture

Strict TypeScript npm-workspace modular monolith: Next.js App Router frontend, NestJS API,
single Prisma/PostgreSQL schema and migration history, Redis and independent BullMQ worker.
No business endpoints, auth, billing or provider send adapters have been implemented.

## Files created

All source files are new because the workspace was empty.

- Root: package.json, package-lock.json, tsconfig.json, tsconfig.services.json,
  eslint.config.mjs, .prettierrc.json, .prettierignore, .gitignore, .dockerignore,
  .env.example, docker-compose.yml, docker-compose.host.yml, README.md.
- apps/api: package.json; src/main.ts, app.module.ts, http.ts, infrastructure.service.ts.
- apps/web: package.json, tsconfig.json, next-env.d.ts; app/layout.tsx, page.tsx, styles.css.
- apps/worker: package.json and src/main.ts.
- packages/config: package.json and src/index.ts.
- packages/shared-types: package.json and src/index.ts.
- packages/database: package.json; prisma/schema.prisma, migrations/migration_lock.toml,
  migrations/20261030000100_foundation/migration.sql.
- scripts/smoke.ts, tests/config.test.ts.
- infrastructure/docker/Dockerfile and .github/workflows/ci.yml.
- docs/architecture.md, api-design.md, security.md, decisions.md, development-plan.md,
  integration.md, email.md, project-brief.md, additional-requirements.md, verification.md.

Ignored local outputs: .env, node_modules, dist, .next, TypeScript build metadata and Docker logs.

## Commands and results

| Check / command                                                                                                          | Final result                                                                     |
| ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| node --version / npm.cmd --version                                                                                       | Node 22.20.0 / npm 11.6.2                                                        |
| docker info                                                                                                              | Docker engine 28.5.2 accessible with permission                                  |
| npm.cmd install --no-audit --no-fund                                                                                     | Passed; dependency lockfile created                                              |
| npm.cmd run db:generate                                                                                                  | Passed; Prisma Client 6.19.3                                                     |
| npm.cmd run lint                                                                                                         | Passed, zero warnings                                                            |
| npm.cmd run typecheck                                                                                                    | Passed API/worker/shared/web                                                     |
| npm.cmd test                                                                                                             | Passed 2 tests, 0 failures                                                       |
| npm.cmd run format:check                                                                                                 | Passed                                                                           |
| npm.cmd run build                                                                                                        | Passed service TypeScript compilation and Next.js production build               |
| docker compose config --quiet                                                                                            | Passed                                                                           |
| docker compose build api                                                                                                 | Passed; shared autometa-development:local image                                  |
| docker compose up -d --wait --no-build                                                                                   | Passed                                                                           |
| Migration service: npm run db:migrate                                                                                    | Applied 20261030000100_foundation; subsequent startup found no pending migration |
| docker compose exec -T -e API_BASE_URL=http://api:4000/api/v1 -e WEB_ORIGIN=http://web:3000 api npm run test:integration | Passed                                                                           |
| Host HTTP requests                                                                                                       | Frontend and API readiness both returned 200                                     |
| Browser visual QA                                                                                                        | Not performed: no browser available                                              |

The smoke test queries the migrated Tenant table, calls readiness, checks structured 404/request ID
presence, sends a unique health job through BullMQ and waits for the separate worker to query
PostgreSQL and return a result, then checks that Next.js HTML contains the live API-connected state.
No messages, business events or real provider calls occur.

## Issues encountered and resolved

- PowerShell blocks npm.ps1: use npm.cmd.
- Sandbox lacked Docker access and Prisma engine download connectivity: permission-enabled
  commands succeeded. A stalled sandbox npm installation was stopped and retried successfully.
- Initial frontend typecheck found an incorrect relative shared import: corrected and rechecked.
- Parallel Compose services exporting the same image caused an already-exists error: only API now
  defines the build; migration/web/worker reuse that image. Startup uses one explicit build.
- Host port 4000 was already allocated: published ports are configurable and this local .env
  uses web 3100 and API 4100. Existing applications were left running.

## Current local state

Services are left running for review.

- Frontend: http://localhost:3100
- API readiness: http://localhost:4100/api/v1/health/ready
- Internal container web/API ports: 3000/4000.
- PostgreSQL and Redis: healthy, persistent volumes, no published database ports.
- Worker: ready; its real queue round trip passed.
- Migration container: completed successfully.

Default example published ports remain 3000/4000; README explains configuring alternatives.
Stop this project's stack with docker compose down; data volumes remain intact.

## Remaining work and review boundary

Review this foundation before milestone 2: registration/verification, Argon2id, sessions,
tenant authorization, environment-specific hash-only API keys, schema migrations and two-tenant
isolation tests. See development-plan.md for subsequent milestones.

Gmail EmailService/mock/Nodemailer adapters, actual SMTP verification/send, inbound processing,
rate/usage policy, external sample application E2E, and Hostinger verification are planned and
have NOT been tested or implemented in this milestone. Credentials and authorized test destinations
remain unresolved. SMTP acceptance must not be represented as delivery confirmation.
The CI workflow is defined but has not been run on a hosted CI provider.

## Folder reorganization ? 31 October 2026

The file inventory above records the original milestone layout. Current paths are:

| Original                 | Current                                       |
| ------------------------ | --------------------------------------------- |
| apps/api                 | backend/api                                   |
| apps/worker              | backend/worker                                |
| apps/web                 | users                                         |
| No implemented admin app | admin/README.md reserves the dashboard folder |

Updated npm workspaces/lockfile and local workspace links, service entry points, TypeScript
includes/extends, shared-type import, Docker COPY paths, README and architecture decisions.
Shared packages, scripts/tests, documentation and infrastructure remain at root. Removed
the empty apps folder. No new product feature or schema migration was introduced.

Lint, type checking, both existing tests and the production build passed after the move.

Docker image build and Compose startup also passed with the new paths. The integration
smoke test passed against the rebuilt services: migrated database, API, Redis, separate
worker round trip and frontend-to-backend communication. Services remain on ports 3100/4100.

## Strict three-folder layout ? current organization

The user clarified that the top level must contain only admin, backend and users. This
supersedes every earlier layout entry in this report. All former root files/folders,
including hidden configuration, environment settings, node_modules, package files, Docker
configuration, docs, tests, infrastructure and build output, were moved inside backend.
Users now has its own package.json, package-lock.json, node_modules, TypeScript/ESLint/
formatting settings, environment example, README and Dockerfile. Admin remains reserved.

Backend service entry paths are api/src and worker/src. Backend shared packages remain
under backend/packages. Docker Compose runs from backend, builds from the parent context
and starts the frontend in /app/users with independent dependencies. Secrets and build
outputs are excluded by Dockerfile-specific ignore files. Backend and frontend have
separate npm installation/build commands; no package or node_modules is needed at root.

Verified the directory listing including hidden entries equals exactly admin/backend/users
and all three are directories. Verified backend/frontend package files and node_modules
exist within their respective directories. Backend lint/typecheck, two tests, Prisma
generation and build passed. Frontend lint/typecheck/build and formatting passed.
Generated Next.js declarations are ignored by formatting; Turbopack root is explicitly
users to prevent workspace discovery from traversing into unrelated parent projects.

The nested backend/.github workflow is a reference template; GitHub does not auto-discover
nested workflows. This preserves the user's explicit no-root-files requirement.

Final Docker rebuild and startup from backend passed. The integration smoke test passed
against the rebuilt stack, including the separate worker and frontend/backend connection.
A final hidden-inclusive root listing assertion passed: exactly admin, backend and users,
all directories, with no other root entries. Published URLs remain localhost:3100/4100.

## Account/admin increment

Authentication, tenant API keys and the new admin/business portals are implemented and
verified in the separate phase-2-verification.md report. Earlier entries in this historical
report describe the foundation at that point in time. Current local testing instructions
are in local-testing.md. Top level remains exactly admin, backend and users.
