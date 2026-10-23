-- AlterTable
ALTER TABLE "insurers" ADD COLUMN     "coverGuides" JSONB;

-- CreateTable
CREATE TABLE "insurer_reviews" (
    "id" UUID NOT NULL,
    "insurerId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "policyNumber" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "insurer_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "insurer_reviews_insurerId_idx" ON "insurer_reviews"("insurerId");

-- CreateIndex
CREATE UNIQUE INDEX "insurer_reviews_policyNumber_customerId_key" ON "insurer_reviews"("policyNumber", "customerId");

-- AddForeignKey
ALTER TABLE "insurer_reviews" ADD CONSTRAINT "insurer_reviews_insurerId_fkey" FOREIGN KEY ("insurerId") REFERENCES "insurers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurer_reviews" ADD CONSTRAINT "insurer_reviews_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurer_reviews" ADD CONSTRAINT "insurer_reviews_policyNumber_fkey" FOREIGN KEY ("policyNumber") REFERENCES "policies"("policyNumber") ON DELETE CASCADE ON UPDATE CASCADE;

