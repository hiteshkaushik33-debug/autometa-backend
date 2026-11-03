# Phase 2: authenticated administration and tenant onboarding

The user's request to advance authorizes milestone 2 and the admin/account portions of milestone 3.
Keep the strict admin/backend/users top level. Implement and verify this increment before business
automation, real email, billing and production readiness. No production deployment occurs now.

Acceptance: Argon2id registration/login, verification/reset, short-lived JWT plus rotating and
revocable hashed refresh sessions, login throttling, server-derived tenant scope and RBAC;
trusted super-admin provisioning; real admin tenant aggregates/status controls/audit history;
tenant profile, hash-only development/production API-key create/list/revoke/rotate and scoped usage.
Separate admin and user Next.js apps proxy through HttpOnly cookies with origin checks.
Mock email is explicitly labeled and only authenticated owners can view their local auth inbox.
Two-tenant integration tests cover ownership, forged roles, revocation and suspension.
No fake revenue, activity or customer charts. Show unfinished modules as planned.
