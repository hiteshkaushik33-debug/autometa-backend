CREATE TYPE "TenantStatus" AS ENUM ('TRIAL', 'ACTIVE', 'SUSPENDED');
CREATE TABLE "Tenant" (
  "id" UUID NOT NULL,
  "name" VARCHAR(200) NOT NULL,
  "status" "TenantStatus" NOT NULL DEFAULT 'TRIAL',
  "timezone" VARCHAR(80) NOT NULL DEFAULT 'UTC',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Tenant_status_createdAt_idx" ON "Tenant"("status", "createdAt");
