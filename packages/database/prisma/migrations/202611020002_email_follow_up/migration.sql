-- AlterTable
ALTER TABLE "EmailAutomation" ADD COLUMN     "followUpEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "OutboundEmail" ADD COLUMN     "parentEmailId" UUID,
ADD COLUMN     "scheduledAt" TIMESTAMPTZ(3);

-- CreateIndex
CREATE UNIQUE INDEX "OutboundEmail_parentEmailId_key" ON "OutboundEmail"("parentEmailId");

-- AddForeignKey
ALTER TABLE "OutboundEmail" ADD CONSTRAINT "OutboundEmail_parentEmailId_fkey" FOREIGN KEY ("parentEmailId") REFERENCES "OutboundEmail"("id") ON DELETE CASCADE ON UPDATE CASCADE;

