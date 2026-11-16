CREATE TYPE "public"."ComparisonTaxonomyCategory" AS ENUM('COVERAGE', 'EXCLUSION', 'LIMIT', 'EXCESS', 'ADD_ON');--> statement-breakpoint
CREATE TYPE "public"."ComparisonTaxonomyStatus" AS ENUM('ACTIVE', 'DISABLED');--> statement-breakpoint
CREATE TYPE "public"."ComparisonValueType" AS ENUM('TEXT', 'NUMBER', 'BOOLEAN', 'CURRENCY', 'LIST');--> statement-breakpoint
CREATE TYPE "public"."ComparisonDisplayRule" AS ENUM('ALWAYS_SHOW', 'SHOW_WHEN_PROVIDED');--> statement-breakpoint
CREATE TYPE "public"."RuleSettingKey" AS ENUM('PIA_FLOOR', 'QUOTE_REPLY_DEADLINE', 'NCD_POLICY', 'DRIVER_QUESTIONS', 'RISK_QUESTIONS', 'ADD_ON_CATALOGUE', 'USAGE_LOADINGS', 'DOCUMENT_RETENTION');--> statement-breakpoint
CREATE TYPE "public"."RuleSettingState" AS ENUM('PROVISIONAL', 'CONFIRMED');--> statement-breakpoint
CREATE TABLE "comparison_taxonomy_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" varchar(80) NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"category" "ComparisonTaxonomyCategory" NOT NULL,
	"versionNumber" integer DEFAULT 1 NOT NULL,
	"dataType" "ComparisonValueType" DEFAULT 'TEXT' NOT NULL,
	"unit" varchar(80),
	"allowedValues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"displayRule" "ComparisonDisplayRule" DEFAULT 'SHOW_WHEN_PROVIDED' NOT NULL,
	"status" "ComparisonTaxonomyStatus" DEFAULT 'ACTIVE' NOT NULL,
	"displayOrder" integer DEFAULT 0 NOT NULL,
	"createdByStaffId" uuid NOT NULL,
	"updatedByStaffId" uuid,
	"createdAt" timestamp (3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_rule_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" "RuleSettingKey" NOT NULL,
	"versionNumber" integer NOT NULL,
	"state" "RuleSettingState" DEFAULT 'PROVISIONAL' NOT NULL,
	"value" jsonb NOT NULL,
	"effectiveFrom" date NOT NULL,
	"effectiveUntil" date,
	"createdByStaffId" uuid NOT NULL,
	"confirmedByStaffId" uuid,
	"confirmedAt" timestamp (3) with time zone,
	"createdAt" timestamp (3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "platform_rule_versions_effective_window_check" CHECK ("platform_rule_versions"."effectiveUntil" IS NULL OR "platform_rule_versions"."effectiveUntil" >= "platform_rule_versions"."effectiveFrom")
);
--> statement-breakpoint
CREATE TABLE "product_version_comparison_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"productVersionId" uuid NOT NULL,
	"taxonomyItemId" uuid NOT NULL,
	"taxonomyVersion" integer NOT NULL,
	"taxonomyCode" varchar(80) NOT NULL,
	"taxonomyLabel" text NOT NULL,
	"taxonomyDescription" text,
	"taxonomyCategory" "ComparisonTaxonomyCategory" NOT NULL,
	"taxonomyDataType" "ComparisonValueType" NOT NULL,
	"taxonomyUnit" varchar(80),
	"taxonomyAllowedValues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"taxonomyDisplayRule" "ComparisonDisplayRule" NOT NULL,
	"included" boolean DEFAULT true NOT NULL,
	"valueText" text,
	"createdAt" timestamp (3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
-- Existing approved versions were created before product-level rates existed.
-- Carry each insurer's then-current rate forward before making the new field
-- mandatory, so their history remains readable and the migration is safe on a
-- populated production database.
ALTER TABLE "insurer_product_versions" ADD COLUMN "rateBps" integer;--> statement-breakpoint
UPDATE "insurer_product_versions" AS "version"
SET "rateBps" = "insurer"."rateBps"
FROM "insurer_products" AS "product"
INNER JOIN "insurers" AS "insurer" ON "insurer"."id" = "product"."insurerId"
WHERE "version"."productId" = "product"."id";--> statement-breakpoint
ALTER TABLE "insurer_product_versions" ALTER COLUMN "rateBps" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "insurer_product_versions" ADD COLUMN "showEstimate" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "insurer_product_versions" ADD COLUMN "allowedDurations" "CoverageDuration"[] DEFAULT ARRAY['Q1', 'Q2', 'Q3', 'Q4']::"CoverageDuration"[] NOT NULL;--> statement-breakpoint
ALTER TABLE "comparison_taxonomy_items" ADD CONSTRAINT "comparison_taxonomy_items_createdByStaffId_fkey" FOREIGN KEY ("createdByStaffId") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "comparison_taxonomy_items" ADD CONSTRAINT "comparison_taxonomy_items_updatedByStaffId_fkey" FOREIGN KEY ("updatedByStaffId") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "platform_rule_versions" ADD CONSTRAINT "platform_rule_versions_createdByStaffId_fkey" FOREIGN KEY ("createdByStaffId") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "platform_rule_versions" ADD CONSTRAINT "platform_rule_versions_confirmedByStaffId_fkey" FOREIGN KEY ("confirmedByStaffId") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "product_version_comparison_items" ADD CONSTRAINT "product_version_comparison_items_productVersionId_fkey" FOREIGN KEY ("productVersionId") REFERENCES "public"."insurer_product_versions"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "product_version_comparison_items" ADD CONSTRAINT "product_version_comparison_items_taxonomyItemId_fkey" FOREIGN KEY ("taxonomyItemId") REFERENCES "public"."comparison_taxonomy_items"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "comparison_taxonomy_items_code_key" ON "comparison_taxonomy_items" USING btree ("code");--> statement-breakpoint
CREATE INDEX "comparison_taxonomy_items_status_order_idx" ON "comparison_taxonomy_items" USING btree ("status","displayOrder");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_rule_versions_key_versionNumber_key" ON "platform_rule_versions" USING btree ("key","versionNumber");--> statement-breakpoint
CREATE INDEX "platform_rule_versions_key_effectiveFrom_idx" ON "platform_rule_versions" USING btree ("key","effectiveFrom");--> statement-breakpoint
CREATE INDEX "platform_rule_versions_state_effectiveFrom_idx" ON "platform_rule_versions" USING btree ("state","effectiveFrom");--> statement-breakpoint
CREATE UNIQUE INDEX "product_version_comparison_items_version_taxonomy_key" ON "product_version_comparison_items" USING btree ("productVersionId","taxonomyItemId");--> statement-breakpoint
CREATE INDEX "product_version_comparison_items_productVersionId_idx" ON "product_version_comparison_items" USING btree ("productVersionId");--> statement-breakpoint
ALTER TABLE "insurer_product_versions" ADD CONSTRAINT "insurer_product_versions_rateBps_check" CHECK ("insurer_product_versions"."rateBps" >= 0 AND "insurer_product_versions"."rateBps" <= 10000);
