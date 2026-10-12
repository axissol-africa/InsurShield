-- AlterTable
ALTER TABLE "quote_requests" ADD COLUMN     "renewalOfPolicyNumber" TEXT;

-- CreateIndex
CREATE INDEX "quote_requests_renewalOfPolicyNumber_idx" ON "quote_requests"("renewalOfPolicyNumber");

-- AddForeignKey
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_renewalOfPolicyNumber_fkey" FOREIGN KEY ("renewalOfPolicyNumber") REFERENCES "policies"("policyNumber") ON DELETE SET NULL ON UPDATE CASCADE;

