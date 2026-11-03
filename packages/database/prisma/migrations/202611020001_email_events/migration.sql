-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('QUEUED', 'SENDING', 'RETRY', 'MOCK_ACCEPTED', 'SMTP_ACCEPTED', 'SUPPRESSED', 'FAILED', 'UNKNOWN');

-- CreateTable
CREATE TABLE "EmailAutomation" (
    "tenantId" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "enabledEvents" TEXT[] DEFAULT ARRAY['lead.created', 'contact.created', 'inquiry.received', 'feedback.submitted']::TEXT[],
    "subject" VARCHAR(200) NOT NULL DEFAULT 'We received your message at {{businessName}}',
    "body" TEXT NOT NULL DEFAULT 'Hi {{contactName}},

{{businessName}} has received your message. We will get back to you soon.

Reference: {{reference}}',
    "dailyLimit" INTEGER NOT NULL DEFAULT 20,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "EmailAutomation_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "phone" VARCHAR(40),
    "transactionalAllowed" BOOLEAN NOT NULL DEFAULT false,
    "permissionEvidence" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationEvent" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "environment" VARCHAR(12) NOT NULL,
    "externalEventId" VARCHAR(128) NOT NULL,
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "payloadHash" CHAR(64) NOT NULL,
    "eventType" VARCHAR(80) NOT NULL,
    "encryptedPayload" TEXT NOT NULL,
    "contactId" UUID NOT NULL,
    "emailDecision" VARCHAR(80) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboundEmail" (
    "id" UUID NOT NULL,
    "tenantId" UUID,
    "userId" UUID,
    "integrationEventId" UUID,
    "purpose" VARCHAR(24) NOT NULL,
    "provider" VARCHAR(12) NOT NULL,
    "sender" VARCHAR(254) NOT NULL,
    "recipient" VARCHAR(254) NOT NULL,
    "subject" VARCHAR(200) NOT NULL,
    "encryptedBody" TEXT NOT NULL,
    "status" "EmailStatus" NOT NULL DEFAULT 'QUEUED',
    "errorCode" VARCHAR(80),
    "providerMessageId" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "quotaDay" VARCHAR(10),
    "leaseUntil" TIMESTAMPTZ(3),
    "dispatchToken" UUID,
    "expiresAt" TIMESTAMPTZ(3),
    "acceptedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "OutboundEmail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailOutbox" (
    "id" UUID NOT NULL,
    "tenantId" UUID,
    "emailId" UUID NOT NULL,
    "claimToken" UUID,
    "leaseUntil" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailAttempt" (
    "id" UUID NOT NULL,
    "tenantId" UUID,
    "emailId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "outcome" VARCHAR(40) NOT NULL,
    "safeCode" VARCHAR(80),
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ(3),

    CONSTRAINT "EmailAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageCounter" (
    "key" VARCHAR(200) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "UsageCounter_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "EmailSuppression" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "emailHash" CHAR(64) NOT NULL,
    "encryptedAddress" TEXT NOT NULL,
    "reason" VARCHAR(40) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailSuppression_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Contact_tenantId_email_key" ON "Contact"("tenantId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_id_tenantId_key" ON "Contact"("id", "tenantId");

-- CreateIndex
CREATE INDEX "IntegrationEvent_tenantId_createdAt_idx" ON "IntegrationEvent"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationEvent_tenantId_environment_externalEventId_key" ON "IntegrationEvent"("tenantId", "environment", "externalEventId");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationEvent_tenantId_environment_idempotencyKey_key" ON "IntegrationEvent"("tenantId", "environment", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationEvent_id_tenantId_key" ON "IntegrationEvent"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "OutboundEmail_integrationEventId_key" ON "OutboundEmail"("integrationEventId");

-- CreateIndex
CREATE INDEX "OutboundEmail_tenantId_createdAt_idx" ON "OutboundEmail"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "OutboundEmail_status_leaseUntil_idx" ON "OutboundEmail"("status", "leaseUntil");

-- CreateIndex
CREATE UNIQUE INDEX "OutboundEmail_id_tenantId_key" ON "OutboundEmail"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "OutboundEmail_integrationEventId_tenantId_key" ON "OutboundEmail"("integrationEventId", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailOutbox_emailId_key" ON "EmailOutbox"("emailId");

-- CreateIndex
CREATE INDEX "EmailOutbox_publishedAt_leaseUntil_idx" ON "EmailOutbox"("publishedAt", "leaseUntil");

-- CreateIndex
CREATE INDEX "EmailAttempt_tenantId_startedAt_idx" ON "EmailAttempt"("tenantId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailAttempt_emailId_number_key" ON "EmailAttempt"("emailId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "EmailSuppression_tenantId_emailHash_key" ON "EmailSuppression"("tenantId", "emailHash");

-- AddForeignKey
ALTER TABLE "EmailAutomation" ADD CONSTRAINT "EmailAutomation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationEvent" ADD CONSTRAINT "IntegrationEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationEvent" ADD CONSTRAINT "IntegrationEvent_contactId_tenantId_fkey" FOREIGN KEY ("contactId", "tenantId") REFERENCES "Contact"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundEmail" ADD CONSTRAINT "OutboundEmail_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundEmail" ADD CONSTRAINT "OutboundEmail_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundEmail" ADD CONSTRAINT "OutboundEmail_integrationEventId_tenantId_fkey" FOREIGN KEY ("integrationEventId", "tenantId") REFERENCES "IntegrationEvent"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailOutbox" ADD CONSTRAINT "EmailOutbox_emailId_fkey" FOREIGN KEY ("emailId") REFERENCES "OutboundEmail"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailAttempt" ADD CONSTRAINT "EmailAttempt_emailId_fkey" FOREIGN KEY ("emailId") REFERENCES "OutboundEmail"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailSuppression" ADD CONSTRAINT "EmailSuppression_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

