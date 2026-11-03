-- AlterEnum
ALTER TYPE "EmailStatus" ADD VALUE 'WAITING_CREDITS';

-- AlterTable
ALTER TABLE "OutboundEmail" ADD COLUMN     "billingCostPaise" INTEGER;

-- CreateTable
CREATE TABLE "CreditAccount" (
    "tenantId" UUID NOT NULL,
    "availablePaise" INTEGER NOT NULL DEFAULT 0,
    "reservedPaise" INTEGER NOT NULL DEFAULT 0,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CreditAccount_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "CreditLedger" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "kind" VARCHAR(24) NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "reservedDeltaPaise" INTEGER NOT NULL DEFAULT 0,
    "reference" VARCHAR(200) NOT NULL,
    "description" VARCHAR(200) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailCreditHold" (
    "emailId" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "state" VARCHAR(16) NOT NULL DEFAULT 'HELD',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "EmailCreditHold_pkey" PRIMARY KEY ("emailId")
);

-- CreateTable
CREATE TABLE "CreditTopUp" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "packId" VARCHAR(20) NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'INR',
    "status" VARCHAR(32) NOT NULL DEFAULT 'CREATING',
    "providerOrderId" VARCHAR(100),
    "providerPaymentId" VARCHAR(100),
    "refundedPaise" INTEGER NOT NULL DEFAULT 0,
    "disputed" BOOLEAN NOT NULL DEFAULT false,
    "errorCode" VARCHAR(80),
    "paidAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CreditTopUp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentWebhook" (
    "eventId" VARCHAR(160) NOT NULL,
    "payloadHash" CHAR(64) NOT NULL,
    "eventType" VARCHAR(100) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentWebhook_pkey" PRIMARY KEY ("eventId")
);

-- CreateIndex
CREATE INDEX "CreditLedger_tenantId_createdAt_idx" ON "CreditLedger"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CreditLedger_tenantId_reference_key" ON "CreditLedger"("tenantId", "reference");

-- CreateIndex
CREATE INDEX "EmailCreditHold_tenantId_state_idx" ON "EmailCreditHold"("tenantId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "CreditTopUp_providerOrderId_key" ON "CreditTopUp"("providerOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditTopUp_providerPaymentId_key" ON "CreditTopUp"("providerPaymentId");

-- CreateIndex
CREATE INDEX "CreditTopUp_tenantId_createdAt_idx" ON "CreditTopUp"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CreditTopUp_tenantId_idempotencyKey_key" ON "CreditTopUp"("tenantId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "CreditAccount" ADD CONSTRAINT "CreditAccount_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditLedger" ADD CONSTRAINT "CreditLedger_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailCreditHold" ADD CONSTRAINT "EmailCreditHold_emailId_fkey" FOREIGN KEY ("emailId") REFERENCES "OutboundEmail"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditTopUp" ADD CONSTRAINT "CreditTopUp_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "CreditAccount" ADD CONSTRAINT "CreditAccount_reserved_nonnegative" CHECK ("reservedPaise" >= 0);
ALTER TABLE "EmailCreditHold" ADD CONSTRAINT "EmailCreditHold_amount_positive" CHECK ("amountPaise" > 0);
ALTER TABLE "CreditTopUp" ADD CONSTRAINT "CreditTopUp_amount_valid" CHECK ("amountPaise" > 0 AND "refundedPaise" >= 0 AND "refundedPaise" <= "amountPaise");
