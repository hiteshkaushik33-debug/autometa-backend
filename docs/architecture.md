# Architecture

## Repository review

The workspace was empty on 30 October 2026, with no Git repository, applications,
package manifests, reusable components or local agent instructions. Node 22.20.0,
npm 11.6.2 and Docker 28.5.2 were installed. PowerShell blocks npm.ps1; npm.cmd works.
The initial sandbox could not access the Docker daemon; elevated Docker access succeeds.

## Implemented foundation

Use a TypeScript strict npm-workspace modular monolith. Next.js handles presentation;
NestJS owns business authorization and writes; a separate process owns BullMQ jobs.
PostgreSQL is the source of truth, Redis stores queue state. Services communicate on the
Compose network. Browser traffic reaches loopback-bound web/API ports. PostgreSQL/Redis
are not published except with an explicit loopback-only host-development override.

Next.js server rendering calls NestJS with a four-second deadline, showing an unavailable
state on failure. The readiness route queries PostgreSQL and Redis; liveness is independent.
A system-health job checks worker/database round trips without introducing business behavior.

## Module boundaries for later milestones

- Auth/users/tenants: credential lifecycle, verified identity, roles and tenant context.
- API keys/events: hash-only keys, environment scope, request limits, ingestion and deduplication.
- Contacts/leads/feedback: tenant repositories, communication preferences and retention.
- Workflows: predefined configurations, executions and durable scheduling.
- Email/AI/Telegram: provider-neutral application services and separate adapters.
- Subscriptions/billing/usage: versioned entitlements, verified payment events and atomic counters.
- Reports/audit/admin: aggregate operations, constrained support access and immutable audit records.

API and workers reuse domain modules and the single Prisma source; no worker-only schema.
Redis is not the sole record of accepted work: ingestion must commit an event and outbox atomically.
An outbox dispatcher retries publishing deterministic job IDs after queue failures.

## Initial schema outline

Only Tenant (UUID, name, status, timezone, timestamps, status index) is migrated in milestone 1.
Future migrations add User, Session, verification/reset tokens, ApiKey (hash/prefix/environment),
BusinessProfile, Contact, Lead, Event, Outbox, Workflow, WorkflowExecution, AutomationJob,
Conversation, Message, KnowledgeBaseEntry, EmailTemplate, TelegramConnection,
SubscriptionPlanVersion, Subscription, Payment, UsageRecord, AiUsage, Report, AuditLog,
ProviderWebhookEvent, EmailAttempt, SenderIdentity and Suppression.

Tenant-owned rows require tenantId, tenant-scoped unique constraints and composite references
(e.g. conversation tenant/contact -> contact tenant/id). Event deduplication is tenant/environment
scoped; usage records and action dispatch have unique business idempotency keys.
Billing uses integer minor units. Plan versions preserve existing contracts. Retention and
deletion policies must be defined before collecting customer content. Raw provider payloads
must not be retained indefinitely.

## Reliability design to implement

Incoming integration requests validate and persist, then return 202. Workers process asynchronously.
Quota reservations and action state transitions are atomic. Retries distinguish transient failures
from permanent errors. SMTP cannot guarantee exactly-once delivery after an ambiguous connection
failure; reserve ambiguous sends for reconciliation rather than blindly retrying.

## Folder organization (31 October 2026)

Backend services now live in backend/api and backend/worker. The existing Next.js frontend
lives in users. The admin folder is reserved for the future admin dashboard. Shared packages,
infrastructure, scripts and tests remain at the root. Historical milestone reports describe
the original layout. No new dashboard functionality is introduced by this reorganization.

## Current three-folder layout ? supersedes the earlier organization

Only admin, backend and users may exist at the project top level. All backend services,
shared packages, dependencies, environment files, Docker orchestration, docs, tests and
tooling live under backend. Users has its own dependencies, lockfile, TypeScript/ESLint
configuration and Dockerfile. Admin is reserved until its dashboard is implemented.
Run backend commands from backend and frontend commands from users. The Docker context
is their parent directory; Dockerfile-specific ignore files exclude secrets and outputs.

## Current identity/admin modules

The identity migration adds User, Session, RefreshCredential, AccountToken, encrypted
MockEmail, ApiKey and AuditLog plus tenant profile/trial fields. Database constraints bind
tenant-admin users to tenants and platform admins to no tenant. Nest SecurityModule uses
one exported InfrastructureModule, strict input pipes, explicit role/tenant service checks
and transactions for state/audit writes. API-key caps use a tenant-row lock.

Admin and user Next.js apps now have independent dependency trees and a shared server-only
proxy implementation under backend/packages/web-proxy. Allowlisted endpoints, configured
origin checks and separate namespaced HttpOnly cookies protect the browser transport.
The admin API exposes explicitly selected profiles/aggregates, not customer content.
Mock authentication mail is an encrypted local adapter, not a complete outbound pipeline.
