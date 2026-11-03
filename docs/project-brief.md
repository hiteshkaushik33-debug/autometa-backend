# CODEX MASTER DEVELOPMENT BRIEF

## AI-Powered Multi-Tenant Business Automation SaaS Platform

### 1. Your Role

You are a senior full-stack software engineer, SaaS architect, backend systems engineer, and UI/UX developer.

Your responsibility is to design and implement a production-ready, scalable, secure, multi-tenant SaaS platform for business automation.

**Do not build a basic demo or mock application.** Build a real product with maintainable architecture, secure authentication, reliable automation workflows, subscription billing, AI assistance, and production deployment capabilities.

Work incrementally. Review the existing repository first, create a development plan, and implement one milestone at a time.

Use clean, modular code, strong TypeScript typing, proper validation, and reusable components.

Do not unnecessarily overengineer the application or introduce microservices at the beginning.

---

# 2. Project Overview

**Project Name:** Business Automation SaaS Platform (working title; configurable later).

**Product Type:** Multi-Tenant B2B SaaS.

**Primary Objective:**

Create an automation platform that businesses can integrate into their existing websites, mobile applications, or backend systems through REST APIs.

The platform should automatically manage:

- Customer inquiries and contact forms.
- Lead capture and lead tracking.
- Customer feedback.
- Automated acknowledgement emails.
- AI-generated customer email replies.
- Telegram notifications to business owners.
- Automated and scheduled customer follow-ups.
- Subscription plans and usage-based limits.
- Monthly business activity reports.
- Automation execution history and analytics.

The system must be industry-independent.

Supported example industries include:

- E-commerce
- Clinics and doctors
- Gyms and fitness centers
- Real estate
- Educational institutions
- Salons
- Consulting businesses
- Local service providers
- SaaS products
- Other businesses that collect customer inquiries or leads.

Use a generic event-driven architecture to avoid creating a different backend for every industry.

---

# 3. System User Roles

## 3.1 Super Admin

The platform owner who manages the entire SaaS application.

Responsibilities:

- Manage all registered businesses.
- View subscriptions and billing information.
- Create and manage subscription plans.
- Monitor API activity and usage.
- View automation execution statistics.
- Monitor total AI usage and spending.
- Suspend or reactivate businesses.
- View payment records.
- View platform revenue statistics.
- Access system configuration and audit logs.

The Super Admin must not automatically gain unrestricted access to businesses' sensitive customer messages. Any support-access mechanism must be separately authorized and audited.

## 3.2 Business Admin / Tenant Admin

Every registered business receives its own independent dashboard.

Responsibilities:

- Manage its business profile.
- Purchase and manage subscriptions.
- Generate and rotate API keys.
- View API documentation and integration examples.
- Manage customer contacts and leads.
- Configure predefined automation workflows.
- Edit email templates.
- Upload or enter approved business information for AI replies.
- Connect a Telegram notification destination.
- View automation logs.
- Track API, email, workflow, and AI usage.
- View invoices, payment history, and subscription details.
- Receive and download business reports.

## 3.3 End Customer

An external visitor who interacts with a business's website or application.

Examples:

- Customer submits a contact form.
- Customer requests product information.
- Patient submits a clinic appointment inquiry.
- Gym visitor requests membership details.
- Customer submits feedback.
- Potential buyer requests a callback.

End customers do not need accounts on our SaaS platform.

Their information is submitted to our system through the tenant's API integration.

---

# 4. Recommended Technology Stack

Use the following stack unless the existing repository has an equivalent that should be preserved.

## Frontend

- Next.js with App Router
- TypeScript
- Tailwind CSS
- shadcn/ui
- TanStack Query for server-state management
- React Hook Form
- Zod for form validation
- Recharts for analytics charts
- Lucide Icons

## Backend

- NestJS
- TypeScript
- Prisma ORM
- PostgreSQL
- Redis
- BullMQ for background jobs
- Swagger/OpenAPI
- JWT authentication with secure session/refresh-token handling
- RBAC authorization

## Integrations

- OpenAI API for AI-assisted responses
- Resend or Amazon SES for outbound transactional email
- Provider inbound-email webhooks or an equivalent reply-processing mechanism
- Telegram Bot API
- Razorpay for initial Indian subscription payments
- Stripe as a future optional provider

## Infrastructure

- Docker and Docker Compose
- Nginx reverse proxy
- Ubuntu VPS or equivalent cloud hosting
- HTTPS with TLS certificates
- PM2 only if running outside containers
- Sentry or equivalent error tracking
- Structured JSON logging
- Automated database backups

## Architecture

Use a **modular monolith with separate API and background worker processes**.

Do not introduce Kafka, Kubernetes, or independent microservices for the MVP.

---

# 5. High-Level System Architecture

The system should contain:

1. Public marketing website.
2. Authentication and account management.
3. Super Admin dashboard.
4. Business Admin dashboard.
5. NestJS REST API.
6. Multi-tenant PostgreSQL database.
7. Redis and BullMQ background processing.
8. Automation workflow engine.
9. AI response generation service.
10. Email sending and reply-processing service.
11. Telegram notification service.
12. Subscription and billing service.
13. Usage metering service.
14. Reporting and scheduled-job service.
15. Monitoring, audit logging, and operational tooling.

### System Flow

Business Website / Mobile App

→ Authenticated REST API

→ Validate request and resolve tenant

→ Record event and contact

→ Evaluate business's configured workflows

→ Queue automation jobs

→ Execute email, AI, and Telegram actions

→ Schedule follow-ups

→ Track outcomes, usage, and errors

→ Update dashboard analytics

→ Generate monthly reports.

Important: Do not send emails or execute long-running AI operations synchronously inside the incoming lead API request.

---

# 6. Public Website

Build a responsive and professional SaaS marketing website.

## Pages

- Homepage
- Features
- How It Works
- Pricing
- API Documentation
- Register
- Login
- Forgot Password
- Reset Password
- Contact
- Privacy Policy
- Terms of Service

## Homepage Sections

1. Hero section explaining the automation service.
2. Business problems solved.
3. Product features.
4. How integration works.
5. Supported use cases.
6. API integration example.
7. Subscription plans.
8. Frequently asked questions.
9. Call to action.
10. Footer.

The visual design should feel like a modern developer-focused SaaS product.

Use a clean, responsive layout with proper loading states, error states, accessible forms, and mobile navigation.

Avoid unnecessary animation and excessive dependencies.

## API Documentation

Expose developer-friendly documentation with:

- Authentication instructions.
- API key creation.
- Request/response examples.
- Event types.
- Error codes.
- Rate limits.
- Usage limits.
- Idempotency keys.
- Sample Next.js, Node.js, and PHP integrations.
- Webhook setup instructions for future outbound events.
- OpenAPI specification.

The public documentation must not reveal private tenant data or secret credentials.

---

# 7. Authentication and Authorization

Implement secure authentication using NestJS.

## Features

- Account registration.
- Login.
- Logout.
- Forgot/reset password.
- Email verification.
- Access and refresh token management.
- Secure password hashing with Argon2id or equivalent.
- Session revocation.
- Login rate limiting.
- Role-based route protection.
- Server-side tenant authorization.
- Optional future MFA support.

## Roles

Initial roles:

- SUPER_ADMIN
- TENANT_ADMIN

The architecture may allow future tenant staff roles, but multi-user staff management is outside the initial MVP.

## Registration Flow

1. User registers an account.
2. System verifies email.
3. User creates business profile.
4. System creates an isolated tenant.
5. User selects a subscription plan.
6. After payment confirmation or authorized trial activation, the tenant can access enabled features.
7. User is redirected to the Business Admin dashboard.

Only trusted backend services can assign SUPER_ADMIN privileges.

---

# 8. Super Admin Dashboard

## Dashboard Overview

Display:

- Total businesses.
- Active businesses.
- Suspended businesses.
- Trial accounts.
- Active subscriptions.
- Expired subscriptions.
- Monthly revenue.
- Payment failures.
- Total API requests.
- Total workflows executed.
- Emails sent.
- AI calls and estimated provider cost.
- Automation failure rates.

## Business Management

Features:

- View all tenant businesses.
- Search and filter businesses.
- View tenant profile and subscription status.
- Suspend/reactivate tenant.
- View aggregate resource consumption.
- View account creation and subscription history.

## Plan Management

Allow Super Admin to:

- Create plans.
- Update plan descriptions.
- Configure plan prices.
- Configure monthly API quotas.
- Configure workflow execution quotas.
- Configure AI usage quotas.
- Configure email allowances.
- Enable or disable plan availability.

Changes to active plans must not unexpectedly alter existing customers' billing contracts or entitlements. Use versioned pricing/entitlement records when necessary.

## Billing Analytics

- Payment transactions.
- Revenue reports.
- Renewal status.
- Failed payments.
- Refund records.
- Subscription cancellation records.

## Platform Logs

- API request statistics.
- Automation failures.
- Job retry activity.
- Email delivery failures.
- Telegram delivery failures.
- Operational alerts.
- Administrative audit history.

---

# 9. Business Admin Dashboard

## Overview

Each tenant should see only its own data.

Dashboard widgets:

- Total contacts.
- New leads.
- Leads this month.
- Active automation workflows.
- Completed automation executions.
- Failed automation executions.
- Emails sent.
- Follow-ups scheduled.
- Follow-ups completed.
- AI-generated replies.
- API requests used.
- Subscription usage and remaining quotas.

## Business Profile

Fields:

- Business name.
- Industry.
- Website URL.
- Contact email.
- Support email.
- Business description.
- Business hours and timezone.
- Contact phone (optional).
- Logo.
- Public business details for AI knowledge.

## Contacts and Leads

Features:

- Contact list.
- Lead list.
- Search and filtering.
- Contact detail view.
- Lead source.
- Lead status.
- Contact history.
- Email communication history.
- Automation activity.
- Notes.
- Manual status updates.
- CSV export.
- Delete or anonymize records according to retention rules.

Lead statuses:

- NEW
- CONTACTED
- FOLLOW_UP
- QUALIFIED
- CONVERTED
- CLOSED
- LOST

Track consent and communication preferences separately from lead status.

## Business Settings

- Manage profile.
- Configure sender details.
- Connect Telegram.
- Configure reply settings.
- Configure workflow defaults.
- Set reporting timezone.
- Manage API keys.
- Set retention preferences.
- Manage subscription.

---

# 10. Multi-Tenant API Architecture

This is one of the most important parts of the platform.

All businesses must share one backend while maintaining strict data isolation.

## Tenant Isolation

Every tenant-owned database record must contain an appropriate tenant identifier.

Never trust a `tenantId` supplied in a public API request.

Resolve tenant identity from authenticated credentials.

Enforce tenant authorization in the service/repository layer, including background jobs, reports, exports, and administration endpoints.

For all tenant-scoped queries:

- Check tenant ownership.
- Validate resources belong to the tenant.
- Prevent cross-tenant object references.
- Use tenant-scoped uniqueness where appropriate.
- Test isolation with at least two tenants.

## API Keys

Businesses can:

- Generate API keys.
- View key prefix and metadata.
- Copy the secret only when created.
- Revoke keys.
- Rotate keys.
- View last-used date.
- Assign a name to each key.

Store only securely hashed API keys.

Do not expose API key secrets in logs.

Use environment-specific keys where practical.

## Initial REST Endpoints

### Authentication

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `POST /api/v1/auth/forgot-password`
- `POST /api/v1/auth/reset-password`

### Business

- `GET /api/v1/business`
- `PATCH /api/v1/business`
- `GET /api/v1/business/usage`

### API Keys

- `GET /api/v1/api-keys`
- `POST /api/v1/api-keys`
- `DELETE /api/v1/api-keys/:id`

### Public Integration API

- `POST /api/v1/events`
- `POST /api/v1/leads`
- `POST /api/v1/feedback`
- `GET /api/v1/usage`

Protected business endpoints must require appropriate tenant authorization.

### Automation Management

- `GET /api/v1/automations`
- `POST /api/v1/automations`
- `GET /api/v1/automations/:id`
- `PATCH /api/v1/automations/:id`
- `DELETE /api/v1/automations/:id`
- `GET /api/v1/automations/:id/executions`

Only allow supported predefined workflow configurations in the MVP, not arbitrary user-authored executable code.

### Reporting

- `GET /api/v1/reports/overview`
- `GET /api/v1/reports/usage`
- `GET /api/v1/reports/leads`
- `GET /api/v1/reports/automations`

### Subscription

- `GET /api/v1/subscriptions/plans`
- `GET /api/v1/subscriptions/current`
- `POST /api/v1/subscriptions/checkout`
- `POST /api/v1/subscriptions/cancel`

### Internal Provider Webhooks

- `POST /api/v1/webhooks/payments/razorpay`
- `POST /api/v1/webhooks/email/events`
- `POST /api/v1/webhooks/email/inbound`
- `POST /api/v1/webhooks/telegram`

Webhook routes require provider-specific signature or secret validation, idempotency checks, and replay protection.

## Example Event Request

```json
{
  "event": "lead.created",
  "externalEventId": "evt_customer_1001",
  "contact": {
    "name": "Rahul Sharma",
    "email": "rahul@example.com",
    "phone": "+919000000000"
  },
  "data": {
    "source": "website",
    "industry": "gym",
    "interest": "Premium Membership",
    "message": "Please share the monthly fee."
  },
  "communicationPreferences": {
    "emailTransactional": true,
    "emailMarketing": false
  }
}
```

The server must validate event type, payload size, contact fields, rate limits, subscription entitlements and allowed data.

Communication permissions must be supported by appropriate consent or another valid legal basis. The API must not treat a client's arbitrary boolean as sufficient proof of consent.

## Example API Response

```json
{
  "success": true,
  "eventId": "evt_01ABC",
  "status": "accepted",
  "message": "Event accepted for processing"
}
```

Prefer HTTP 202 for accepted asynchronous processing.

Return structured errors for invalid credentials, invalid payloads, expired subscription, exceeded quota, duplicates and rate limits.

Use idempotency keys to avoid duplicate lead creation and duplicate email sends.

---

# 11. Automation Workflow Engine

Create a generic workflow engine for different industries.

## Supported Event Types

Initial events:

- `lead.created`
- `contact.created`
- `contact.updated`
- `feedback.submitted`
- `inquiry.received`
- `lead.status_changed`
- `lead.converted`

Additional event types should be extendable through a documented event registry.

## Workflow Definitions

Each workflow contains:

- Tenant ID.
- Workflow name.
- Event trigger.
- Enabled/disabled status.
- Optional conditions.
- Ordered action steps.
- Delay configuration.
- Communication channel.
- Template reference.
- AI generation enabled/disabled.
- Creation/update timestamps.

## Supported MVP Actions

- Save or update contact.
- Create a lead.
- Send acknowledgement email.
- Generate AI-assisted email response.
- Notify tenant through Telegram.
- Schedule follow-up email.
- Stop scheduled follow-ups.
- Update lead status.
- Record execution result.

## Predefined Workflow Templates

### Lead Capture Automation

Trigger: new lead submitted.

Steps:

1. Store lead.
2. Send acknowledgement email.
3. Notify business owner via Telegram.
4. Schedule optional follow-up.
5. Record status.

### Customer Inquiry Automation

Trigger: incoming customer inquiry.

Steps:

1. Store inquiry.
2. Evaluate business information.
3. Generate AI response when appropriate.
4. Send email or create a draft for approval.
5. Notify owner.
6. Track reply and resolution.

### Feedback Collection Automation

Trigger: feedback submitted.

Steps:

1. Store feedback.
2. Categorize feedback.
3. Send acknowledgement if appropriate.
4. Notify business owner of urgent negative feedback.
5. Include feedback statistics in reports.

### Scheduled Follow-Up Automation

Trigger: lead has not responded or progressed.

Steps:

1. Wait configured period.
2. Recheck lead status and communication permissions.
3. Check whether customer replied or opted out.
4. Check quota and account status.
5. Send follow-up if permitted.
6. Record execution.
7. Stop after the configured maximum.

Default maximum: three follow-up messages.

Business owners must be able to disable follow-ups and change timing.

## Job Processing

Use BullMQ for:

- Outbound email jobs.
- Telegram notifications.
- AI generation.
- Follow-up scheduling.
- Monthly reports.
- Provider webhook processing.
- Retriable background operations.

Implement:

- Configurable retries.
- Exponential backoff.
- Dead-letter handling or equivalent failed-job review.
- Idempotent execution.
- Execution status history.
- Safe cancellation.
- Concurrency control.
- Graceful worker shutdown.
- Monitoring of failed and delayed jobs.

A repeated webhook or retried job must not send duplicate customer messages.

---

# 12. Hybrid AI Response Engine

The platform combines predefined workflow automation with AI-powered replies.

## Key Principle

The AI should be an optional action within an approved workflow.

Do not build an unconstrained autonomous agent.

AI should only generate business-relevant responses grounded in tenant-approved information.

## Business Knowledge Base

Allow a business to enter and manage:

- Business description.
- Services.
- Products.
- Frequently asked questions.
- Business hours.
- Location/service area.
- Pricing information.
- Booking instructions.
- Return/refund policies.
- Contact details.

Initial MVP: structured text and FAQs.

PDF, website crawling, document ingestion and large-scale RAG should be treated as optional Phase 2 features.

## Response Generation

Example:

Customer inquiry:

"How much is the gym membership?"

Business knowledge:

"Monthly plan ₹1,499; quarterly plan ₹3,999."

AI response:

"Thank you for your interest. Our monthly membership is ₹1,499 and our quarterly membership is ₹3,999. Would you like us to arrange a visit?"

The AI must not invent prices, appointments, medical advice, product availability or policies not present in approved knowledge.

## AI Processing Pipeline

1. Receive inquiry.
2. Validate and sanitize input.
3. Resolve tenant.
4. Load tenant-specific approved knowledge.
5. Select permitted workflow.
6. Determine whether AI is needed.
7. Generate structured response.
8. Validate output and safety constraints.
9. Send automatically only when the confidence/rules permit it.
10. Otherwise send to human review or use a safe predefined fallback.
11. Record AI usage, outcome and cost.

## AI Guardrails

- Strict tenant knowledge isolation.
- No cross-tenant prompts or content retrieval.
- Treat incoming customer content as untrusted.
- Prevent prompt-injection instructions from changing system behavior.
- Never expose API keys or internal configuration.
- Never allow AI to execute arbitrary operations.
- Reject unsupported claims.
- Apply per-tenant AI cost and usage limits.
- Minimize personal information included in model requests.
- Support automated fallback and manual review.
- Never provide autonomous medical diagnosis or treatment advice.

## AI Usage Accounting

Record:

- Tenant ID.
- AI model.
- Prompt tokens.
- Completion tokens.
- Total billable tokens.
- Estimated or actual model cost.
- Workflow execution ID.
- Timestamp.
- Success/failure.

Never expose the platform's OpenAI secret key to tenant users.

---

# 13. Email Automation

Implement a provider-independent email service with an initial provider adapter.

## Features

- Outbound acknowledgement emails.
- AI-generated inquiry replies.
- Follow-up emails.
- Monthly reports.
- Email templates.
- Delivery event processing.
- Bounce/error handling.
- Reply processing for one configured inbound-email integration.

## Sender Configuration

Use a verified platform-managed sending domain for the MVP.

Support tenant branding through display names and approved reply-to addresses.

Custom tenant sending domains and full mailbox integrations are Phase 2 unless explicitly added.

## Reply Tracking

When supported by the configured inbound-email provider:

1. Process inbound email webhook.
2. Validate provider signature.
3. Match the message to a contact or conversation.
4. Store relevant metadata.
5. Mark the inquiry as replied.
6. Cancel pending follow-ups.

If inbound reply tracking is unavailable, label the feature clearly as limited rather than pretending replies are detected.

## Compliance and Deliverability

Implement:

- Suppression lists.
- Opt-out handling.
- Appropriate email preferences.
- Bounce monitoring.
- Sender authentication.
- Per-tenant sending quotas.
- Abuse protection.
- Appropriate record retention.

Never send unsolicited bulk marketing email as part of the MVP.

---

# 14. Telegram Integration

Use the official Telegram Bot API.

## Features

- Business owner connects Telegram by starting the platform bot.
- Use a secure, one-time linking token.
- Verify the correct account/tenant relationship.
- Save the authorized chat ID.
- Send notification on new leads and important inquiries.
- Send critical automation failure notifications when configured.
- Allow disconnecting Telegram.

## Example Notification

New Lead Received

Business: ABC Fitness

Customer: Rahul Sharma

Interest: Premium Membership

Status: New

Received: 30 Oct 2026

Include a link to the tenant dashboard when appropriate.

Important: This integration is for authorized tenant notifications.

Do not assume arbitrary end customers can receive Telegram messages without establishing a bot conversation or another supported authorization mechanism.

---

# 15. Subscription and Payment System

Build a subscription-based SaaS billing system.

Use a payment-provider abstraction to allow future gateway expansion.

Initial provider: Razorpay.

## Suggested Initial Plans

### Starter

₹999/month

- 2,000 API calls
- 500 workflow executions
- 100 AI replies

### Growth

₹2,999/month

- 10,000 API calls
- 2,500 workflow executions
- 750 AI replies

### Business

₹6,999/month

- 40,000 API calls
- 10,000 workflow executions
- 3,000 AI replies

These are configurable reference values, not hardcoded product rules.

Email allowances, token ceilings, overage prices and usage definitions must be configurable before commercial launch.

## Subscription Features

- List available plans.
- Purchase subscription.
- Verify payment gateway events.
- Activate entitlements only after verified payment confirmation.
- View current plan.
- View billing period.
- View usage.
- Cancel renewal.
- Handle failed payments.
- Handle grace periods.
- Enforce subscription restrictions.
- Maintain payment transaction history.

For MVP, use supported gateway-native payment/subscription functionality. Do not assume every payment method supports automatic recurring debits.

## Usage Enforcement

Track at minimum:

- Incoming API requests.
- Accepted billable events.
- Workflow executions.
- Outbound email usage.
- AI reply generation.
- AI token consumption.

Ensure concurrency-safe quota reservation and metering.

Idempotent retries must not double-charge usage.

Define exact rules for billable events and failed executions.

When a quota is exceeded:

- Block or defer only the affected paid operation.
- Return a clear API response.
- Display the exceeded limit.
- Offer a subscription upgrade path.
- Avoid deleting customer data.

---

# 16. Analytics and Monthly Reports

## Dashboard Analytics

Business users should see:

- Leads by date.
- Leads by source.
- Lead status distribution.
- Follow-up activity.
- Email counts.
- Telegram alert counts.
- AI usage.
- Automation execution success/failure.
- API usage trends.
- Quota consumption.

## Monthly Email Reports

Generate and send monthly reports to each active tenant.

Include:

- Reporting period.
- Total leads.
- New contacts.
- Inquiries received.
- Feedback submitted.
- Emails sent.
- Follow-ups performed.
- Automation executions.
- AI replies generated.
- API usage.
- Lead conversion count where recorded.
- Remaining quota or monthly consumption.

Use tenant reporting timezone when calculating periods.

Reports should be generated asynchronously, persisted with a generation status, and retried safely.

Send report email with a secure dashboard link or an appropriate downloadable attachment.

Use real data, not generated demonstration values.

---

# 17. Database Design

Use PostgreSQL with Prisma migrations.

Create normalized models with appropriate indexes, constraints and foreign keys.

## Core Models

### User

- id
- name
- email
- passwordHash
- globalRole
- emailVerifiedAt
- isActive
- createdAt
- updatedAt

### Tenant

- id
- name
- slug
- industry
- website
- description
- timezone
- status
- createdAt
- updatedAt

### TenantMembership

- id
- userId
- tenantId
- role
- createdAt

For the MVP, only one tenant admin account needs to be supported in the UI.

### ApiKey

- id
- tenantId
- name
- keyPrefix
- keyHash
- status
- lastUsedAt
- expiresAt
- createdAt
- revokedAt

### Contact

- id
- tenantId
- externalContactId
- name
- email
- phone
- communicationPreferences
- createdAt
- updatedAt

### Lead

- id
- tenantId
- contactId
- source
- status
- message
- metadata
- createdAt
- updatedAt

### Event

- id
- tenantId
- externalEventId
- eventType
- payload
- processingStatus
- receivedAt

### Workflow

- id
- tenantId
- name
- triggerEvent
- configuration
- enabled
- createdAt
- updatedAt

### WorkflowExecution

- id
- tenantId
- workflowId
- eventId
- status
- startedAt
- completedAt
- errorCode
- errorMessage

### WorkflowStepExecution

- id
- tenantId
- workflowExecutionId
- actionType
- status
- attemptCount
- scheduledAt
- completedAt

### Conversation

- id
- tenantId
- contactId
- channel
- status
- createdAt
- updatedAt

### Message

- id
- tenantId
- conversationId
- direction
- providerMessageId
- deliveryStatus
- content
- sentAt
- receivedAt

### KnowledgeBaseEntry

- id
- tenantId
- category
- title
- content
- isApproved
- updatedAt

### EmailTemplate

- id
- tenantId
- name
- subject
- body
- enabled

### TelegramConnection

- id
- tenantId
- chatId
- status
- connectedAt

### SubscriptionPlan

- id
- name
- code
- price
- currency
- interval
- entitlements
- isActive

### Subscription

- id
- tenantId
- planId
- status
- provider
- providerSubscriptionId
- currentPeriodStart
- currentPeriodEnd
- cancelAtPeriodEnd

### Payment

- id
- tenantId
- subscriptionId
- providerPaymentId
- amount
- currency
- status
- paidAt

### UsageRecord

- id
- tenantId
- subscriptionId
- resourceType
- quantity
- idempotencyKey
- occurredAt

### AiUsage

- id
- tenantId
- workflowExecutionId
- model
- inputTokens
- outputTokens
- estimatedCost
- createdAt

### Report

- id
- tenantId
- reportType
- periodStart
- periodEnd
- generationStatus
- deliveryStatus
- createdAt

### AuditLog

- id
- actorId
- tenantId
- action
- resourceType
- resourceId
- metadata
- createdAt

### ProviderWebhookEvent

- id
- provider
- providerEventId
- status
- processedAt
- createdAt

The above is a starting model inventory, not an instruction to store unlimited personal data.

Add necessary database indexes, constraints, deletion policies, and retention handling.

Use integer minor currency units or an appropriate decimal representation for billing. Never use floating-point money arithmetic.

---

# 18. Security Requirements

Treat security as part of the core architecture.

Required:

- HTTPS in production.
- Secure authentication.
- Password hashing.
- JWT/session revocation.
- RBAC.
- Tenant isolation.
- API key hashing and rotation.
- Request rate limits.
- Payload validation.
- Sensitive data redaction.
- Secure webhook verification.
- Replay protection.
- CSRF protection where cookie-based sessions are used.
- CORS configuration.
- Safe file handling if uploads are added.
- Secure environment variable management.
- Encryption in transit.
- Database backups.
- Audit logging.
- PII retention/deletion controls.
- Subscription abuse protection.
- AI prompt-injection defenses.
- Prevent open email relaying.
- Prevent server-side request forgery.

Never trust business-provided event payloads or AI-generated output as executable instructions.

Do not log passwords, access tokens, API secrets, or complete sensitive customer communications.

Implement proper error handling without leaking stack traces to API consumers.

---

# 19. UI/UX Requirements

The application should look like a professional commercial SaaS.

## Design Direction

- Clean and minimal.
- Modern dashboard layout.
- Neutral surfaces with one consistent accent color.
- Light and dark modes if feasible.
- Responsive design.
- Clear information hierarchy.
- Good typography.
- Consistent tables, forms and charts.
- Keyboard accessibility.
- Loading skeletons.
- Empty states.
- User-friendly validation.
- Confirmation dialogs for destructive operations.

## Dashboard Layout

Desktop:

- Left sidebar.
- Top navigation/header.
- KPI cards.
- Analytics charts.
- Data tables.
- Filters.
- Detail drawers or pages.

Mobile:

- Collapsible navigation.
- Responsive KPI cards.
- Horizontal table scrolling or mobile record views.
- Accessible controls.

Use a reusable design system.

Avoid creating duplicate dashboard components.

---

# 20. Suggested Monorepo Structure

```text
business-automation-saas/
│
├── apps/
│   ├── web/
│   │   ├── app/
│   │   ├── components/
│   │   ├── features/
│   │   ├── lib/
│   │   └── public/
│   │
│   ├── api/
│   │   ├── src/
│   │   │   ├── auth/
│   │   │   ├── users/
│   │   │   ├── tenants/
│   │   │   ├── admin/
│   │   │   ├── contacts/
│   │   │   ├── leads/
│   │   │   ├── events/
│   │   │   ├── api-keys/
│   │   │   ├── workflows/
│   │   │   ├── ai/
│   │   │   ├── email/
│   │   │   ├── telegram/
│   │   │   ├── subscriptions/
│   │   │   ├── billing/
│   │   │   ├── usage/
│   │   │   ├── reports/
│   │   │   ├── audit/
│   │   │   └── common/
│   │   └── test/
│   │
│   └── worker/
│       └── src/
│
├── packages/
│   ├── database/
│   │   └── prisma/
│   ├── shared-types/
│   └── config/
│
├── infrastructure/
│   ├── docker/
│   └── nginx/
│
├── docs/
│   ├── architecture.md
│   ├── api-design.md
│   ├── security.md
│   ├── deployment.md
│   └── decisions.md
│
├── docker-compose.yml
├── .env.example
├── package.json
└── README.md
```

Use a shared workspace setup with pnpm and Turborepo if appropriate.

Avoid excessive abstraction.

All Prisma writes and schema migrations should have one clear source of truth.

---

# 21. Background Jobs and Scheduling

Use separate queues where appropriate:

- `email`
- `telegram`
- `ai`
- `follow-up`
- `reports`
- `webhooks`

Requirements:

- Retry transient failures.
- Do not retry permanent authentication or validation failures indefinitely.
- Deduplicate requests.
- Track attempts.
- Store execution status.
- Respect subscription quotas.
- Respect communication preferences.
- Stop follow-ups on replies and opt-outs.
- Handle worker restarts.
- Avoid duplicate scheduled reports.
- Limit AI and email concurrency.
- Provide operational visibility into failures.

Use a consistent UTC internal clock and convert dates to tenant timezone for display/reporting.

---

# 22. Error Handling and Reliability

Implement standard JSON error responses.

Example:

```json
{
  "success": false,
  "error": {
    "code": "SUBSCRIPTION_QUOTA_EXCEEDED",
    "message": "Monthly workflow execution limit exceeded."
  },
  "requestId": "req_abc123"
}
```

Use appropriate HTTP status codes.

Include:

- Central exception filter.
- Request correlation IDs.
- Health endpoints.
- Database connectivity checks.
- Queue connectivity checks.
- Provider timeout handling.
- Retry policies.
- Monitoring and error reporting.

Do not retry customer-facing actions without idempotency protection.

---

# 23. Testing Strategy

Use automated tests from the beginning.

## Unit Tests

- Authentication services.
- Tenant authorization.
- Event validation.
- Workflow evaluation.
- Follow-up scheduling.
- Quota enforcement.
- AI fallback logic.
- Payment state transitions.
- Usage metering.

## Integration Tests

- API key authentication.
- Lead creation.
- Event ingestion.
- Workflow queueing.
- Email provider adapter.
- Telegram adapter.
- Inbound email processing.
- Payment webhook processing.
- Monthly reporting.

## End-to-End Tests

Test:

1. New business registration.
2. Email verification.
3. Subscription purchase using payment-provider sandbox.
4. API key generation.
5. Website event submission.
6. Contact/lead creation.
7. Automation workflow execution.
8. Email and Telegram notification through mocks or safe test destinations.
9. AI-assisted response.
10. Follow-up scheduling.
11. Follow-up cancellation on reply/opt-out.
12. Usage limit enforcement.
13. Monthly report generation.
14. Tenant suspension.
15. Cross-tenant access denial.

Use realistic test fixtures and mocked external providers.

Never send real customer messages in the test environment.

---

# 24. Deployment Requirements

Provide a production deployment setup.

Minimum environment:

- Ubuntu VPS.
- Docker Compose.
- Next.js frontend.
- NestJS backend.
- Background worker.
- PostgreSQL.
- Redis.
- Nginx.
- HTTPS.

Configure:

- Environment variables.
- Health checks.
- Container restart policies.
- Secure networking.
- Database migrations.
- Persistent storage.
- Backup scheduling.
- Log rotation.
- Error monitoring.
- CI pipeline.
- Staging and production environment separation.

Do not publicly expose PostgreSQL or Redis.

Do not commit production secrets.

Provide `.env.example` documenting every required configuration variable.

## Deployment Documentation

Document:

- Server preparation.
- Environment configuration.
- Docker startup.
- Database setup and migrations.
- API deployment.
- Worker startup.
- Payment webhook configuration.
- Telegram webhook configuration.
- Email domain verification.
- OpenAI API configuration.
- Backups and restoration.
- Monitoring.
- Production release procedure.
- Rollback procedure.

---

# 25. Explicit MVP Scope Boundaries

The MVP must support:

- Public website and documentation.
- Main Admin and Business Admin.
- Registration and authentication.
- Multi-tenant REST API.
- API keys.
- Contacts, leads and feedback.
- Predefined workflow templates.
- Email acknowledgement and follow-ups.
- AI-assisted email generation.
- Telegram owner notifications.
- Inbound email reply processing for one supported integration.
- Usage metering.
- Subscription billing.
- Basic analytics.
- Monthly reports.
- Production deployment.

The following are **not MVP requirements**:

- WhatsApp Business integration.
- SMS automation.
- Voice agents.
- Native mobile apps.
- Visual drag-and-drop workflow builder.
- Arbitrary user-written executable workflow scripts.
- Full CRM integrations.
- Browser automation.
- Custom AI model training.
- Multi-tenant white-label reselling.
- Automated medical advice.
- Enterprise multi-region infrastructure.
- Unlimited third-party platform support.
- Full multi-user organizational team management.

Structure the code so some of these can be added later without a total rewrite.

---

# 26. Development Milestones

Implement the project in the following order.

## Milestone 1 — Repository and Architecture

- Inspect existing repository.
- Identify reusable code and existing dependencies.
- Prepare architecture documentation.
- Set up monorepo if needed.
- Configure Next.js.
- Configure NestJS.
- Configure Prisma/PostgreSQL.
- Configure Redis/BullMQ.
- Create Docker development environment.
- Set up linting, formatting and testing.
- Create shared configuration.
- Document environment variables.

Deliverable: Application skeleton and running infrastructure.

## Milestone 2 — Authentication and Multi-Tenancy

- User registration.
- Login and token handling.
- Email verification.
- Tenant creation.
- Role authorization.
- Tenant guards.
- API key creation.
- Database migrations.
- Tenant-isolation tests.

Deliverable: Secure authenticated multi-tenant foundation.

## Milestone 3 — Dashboards and Public Pages

- Marketing website.
- API documentation.
- Main Admin dashboard.
- Business Admin dashboard.
- Business profile settings.
- Contacts/leads management.
- Reusable UI components.
- Responsive design.

Deliverable: Functional interfaces backed by real APIs.

## Milestone 4 — Events and Workflow Engine

- Event ingestion API.
- Contact deduplication.
- Lead creation.
- Workflow definitions.
- Workflow execution tracking.
- BullMQ workers.
- Predefined templates.
- Scheduled follow-ups.
- Retry/error handling.

Deliverable: Functional event-driven rule-based automation.

## Milestone 5 — AI, Email and Telegram

- Outbound email integration.
- Email templates.
- Inbound email reply processing.
- Telegram bot and linking flow.
- Knowledge-base management.
- AI generation.
- Human-review/fallback behavior.
- Communication preferences.
- AI usage tracking.

Deliverable: Working hybrid-automation functionality.

## Milestone 6 — Subscription and Reporting

- Pricing plans.
- Payment gateway integration.
- Payment webhooks.
- Subscription management.
- Usage quotas.
- Billing analytics.
- Business reports.
- Monthly email reports.

Deliverable: Monetizable SaaS platform.

## Milestone 7 — Testing and Production

- Integration tests.
- End-to-end tests.
- Tenant-security checks.
- Load testing.
- Monitoring.
- Production deployment.
- Documentation.
- Backup and recovery verification.
- Handover.

Deliverable: Production release candidate.

---

# 27. Development Rules for Codex

Follow these instructions throughout implementation:

1. Inspect the repository before making changes.
2. Never overwrite or remove working code without examining its purpose.
3. Do not generate the entire application in one enormous implementation step.
4. Create a milestone-based plan first.
5. Keep changes small, testable and reviewable.
6. Use TypeScript strict mode.
7. Validate all external input.
8. Use Prisma migrations for schema changes.
9. Use DTOs and validation pipes in NestJS.
10. Use a consistent API response and error structure.
11. Keep external providers behind adapters/interfaces.
12. Never hardcode secrets.
13. Never fabricate third-party credentials or claim an integration works without testing.
14. Use mocked providers in local development when credentials are absent.
15. Create automated tests for critical business logic.
16. Ensure all tenant queries are properly scoped.
17. Keep controllers thin and business logic in services.
18. Separate background jobs from HTTP request handling.
19. Use idempotent operations for payments, events and notifications.
20. Document important architecture decisions.
21. Update the README after each milestone.
22. Do not implement optional features unless requested.
23. Explain errors and blockers accurately.
24. Do not mark a module complete until its tests and acceptance conditions pass.
25. Preserve a clear boundary between AI-generated text and authorized backend actions.

---

# 28. Final Acceptance Criteria

The MVP can be considered complete only when:

- Super Admin can securely manage tenant businesses.
- A business can register and subscribe.
- Tenant data is isolated.
- A business can generate, rotate and revoke API keys.
- An integrated application can submit valid events.
- Events create contacts/leads as expected.
- Configured automation workflows run correctly.
- Automated acknowledgement email works.
- AI-generated business-specific email replies work with approved knowledge.
- Telegram owner notifications work.
- Delayed follow-ups work and can be cancelled.
- Replies and opt-outs stop relevant follow-ups.
- Subscription quotas are correctly enforced.
- Payment webhooks are verified and idempotent.
- Usage analytics display actual database records.
- Monthly reports are generated and delivered.
- Failed jobs and provider errors are observable.
- Integration and cross-tenant security tests pass.
- Production deployment and backup procedures are documented.
- No fake production functionality remains.

---

# 29. Your Immediate Task — START WITH MILESTONE 1 ONLY

Before writing significant application code:

1. Inspect the repository and existing files.
2. Summarize its current structure and technology stack.
3. Identify reusable components.
4. Identify missing components and dependencies.
5. Propose the final folder structure.
6. Define system architecture and module boundaries.
7. Prepare an initial Prisma schema outline.
8. List required environment variables.
9. Define the local development workflow.
10. Write an implementation checklist covering all milestones.
11. Identify unresolved third-party integrations and credentials.
12. Document assumptions and decisions in `docs/decisions.md`.

Then implement only Milestone 1.

Set up the development environment and verify:

- Next.js starts successfully.
- NestJS starts successfully.
- PostgreSQL connects.
- Prisma migrations run.
- Redis connects.
- Background worker starts.
- Frontend can communicate with backend.
- Docker Compose runs locally.
- Linting and relevant tests pass.

Create:

- `README.md`
- `.env.example`
- `docs/architecture.md`
- `docs/api-design.md`
- `docs/security.md`
- `docs/decisions.md`
- `docs/development-plan.md`

At the end of Milestone 1, report:

- Files created or changed.
- Architecture implemented.
- Commands executed.
- Tests passed or failed.
- Any outstanding issues.
- Next milestone tasks.

**Do not begin Milestone 2 until the Milestone 1 foundation is verified and reviewed.**

Start now by inspecting the existing repository and preparing the architecture and implementation plan.
