CREATE TYPE "public"."QuoteRequestModel" AS ENUM('LEGACY', 'PRODUCT_SELECTION');--> statement-breakpoint
-- 0028 did not write selected rows. These columns are nevertheless added
-- nullable, then backfilled, so an interrupted or independently deployed
-- 0028 can be upgraded safely without discarding a customer's selection.
ALTER TABLE "quote_request_product_versions" ADD COLUMN "insurerId" uuid;--> statement-breakpoint
ALTER TABLE "quote_request_product_versions" ADD COLUMN "productCode" varchar(80);--> statement-breakpoint
ALTER TABLE "quote_request_product_versions" ADD COLUMN "productVersionNumber" integer;--> statement-breakpoint
ALTER TABLE "quote_request_product_versions" ADD COLUMN "productName" text;--> statement-breakpoint
ALTER TABLE "quote_request_product_versions" ADD COLUMN "coverType" "InsuranceType";--> statement-breakpoint
ALTER TABLE "quote_request_product_versions" ADD COLUMN "coverGuide" jsonb;--> statement-breakpoint
ALTER TABLE "quote_request_product_versions" ADD COLUMN "inspectionRule" "InspectionRule";--> statement-breakpoint
ALTER TABLE "quote_request_product_versions" ADD COLUMN "inspectionTiming" "InspectionTiming";--> statement-breakpoint
ALTER TABLE "quote_request_product_versions" ADD COLUMN "inspectionMethod" "InspectionMethod";--> statement-breakpoint
ALTER TABLE "quote_request_product_versions" ADD COLUMN "cancelledAt" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "quote_request_product_versions" ADD COLUMN "cancelledReason" "QuoteUnavailabilityReason";--> statement-breakpoint
ALTER TABLE "quote_requests" ADD COLUMN "model" "QuoteRequestModel" DEFAULT 'LEGACY' NOT NULL;--> statement-breakpoint
UPDATE "quote_request_product_versions" AS selection
SET
  "insurerId" = product."insurerId",
  "productCode" = product."code",
  "productVersionNumber" = version."versionNumber",
  "productName" = version."name",
  "coverType" = version."coverType",
  "coverGuide" = version."coverGuide",
  "inspectionRule" = version."inspectionRule",
  "inspectionTiming" = version."inspectionTiming",
  "inspectionMethod" = version."inspectionMethod"
FROM "insurer_product_versions" AS version
INNER JOIN "insurer_products" AS product ON product."id" = version."productId"
WHERE version."id" = selection."productVersionId";--> statement-breakpoint
ALTER TABLE "quote_request_product_versions" ALTER COLUMN "insurerId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "quote_request_product_versions" ALTER COLUMN "productCode" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "quote_request_product_versions" ALTER COLUMN "productVersionNumber" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "quote_request_product_versions" ALTER COLUMN "productName" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "quote_request_product_versions" ALTER COLUMN "coverType" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "quote_request_product_versions" ALTER COLUMN "coverGuide" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "quote_request_product_versions" ALTER COLUMN "inspectionRule" SET NOT NULL;--> statement-breakpoint
UPDATE "quote_requests" AS request
SET "model" = 'PRODUCT_SELECTION'
WHERE EXISTS (
  SELECT 1
  FROM "quote_request_product_versions" AS selection
  WHERE selection."quoteRequestId" = request."id"
);--> statement-breakpoint
ALTER TABLE "quote_request_product_versions" ADD CONSTRAINT "quote_request_product_versions_insurerId_fkey" FOREIGN KEY ("insurerId") REFERENCES "public"."insurers"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "quote_request_product_versions_insurerId_cancelledAt_idx" ON "quote_request_product_versions" USING btree ("insurerId","cancelledAt");--> statement-breakpoint
ALTER TABLE "quote_request_product_versions" ADD CONSTRAINT "quote_request_product_versions_inspection_rule_check" CHECK (("quote_request_product_versions"."inspectionRule" = 'NOT_REQUIRED' AND "quote_request_product_versions"."inspectionTiming" IS NULL AND "quote_request_product_versions"."inspectionMethod" IS NULL)
        OR ("quote_request_product_versions"."inspectionRule" <> 'NOT_REQUIRED' AND "quote_request_product_versions"."inspectionTiming" IS NOT NULL AND "quote_request_product_versions"."inspectionMethod" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "quote_request_product_versions" ADD CONSTRAINT "quote_request_product_versions_cancellation_mark_check" CHECK (("quote_request_product_versions"."cancelledAt" IS NULL) = ("quote_request_product_versions"."cancelledReason" IS NULL));
