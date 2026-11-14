CREATE TYPE "public"."ProductVersionStatus" AS ENUM('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'WITHDRAWN');--> statement-breakpoint
CREATE TABLE "insurer_product_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"productId" uuid NOT NULL,
	"versionNumber" integer NOT NULL,
	"status" "ProductVersionStatus" DEFAULT 'DRAFT' NOT NULL,
	"name" text NOT NULL,
	"coverType" "InsuranceType" NOT NULL,
	"coverGuide" jsonb NOT NULL,
	"inspectionRule" "InspectionRule" NOT NULL,
	"inspectionTiming" "InspectionTiming",
	"inspectionMethod" "InspectionMethod",
	"effectiveFrom" date NOT NULL,
	"effectiveUntil" date,
	"createdByStaffId" uuid NOT NULL,
	"submittedByStaffId" uuid,
	"submittedAt" timestamp (3) with time zone,
	"reviewedByStaffId" uuid,
	"reviewedAt" timestamp (3) with time zone,
	"reviewComment" text,
	"withdrawnByStaffId" uuid,
	"withdrawnAt" timestamp (3) with time zone,
	"withdrawalReason" text,
	"createdAt" timestamp (3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "insurer_product_versions_effective_window_check" CHECK ("insurer_product_versions"."effectiveUntil" IS NULL OR "insurer_product_versions"."effectiveUntil" >= "insurer_product_versions"."effectiveFrom"),
	CONSTRAINT "insurer_product_versions_inspection_rule_check" CHECK (("insurer_product_versions"."inspectionRule" = 'NOT_REQUIRED' AND "insurer_product_versions"."inspectionTiming" IS NULL AND "insurer_product_versions"."inspectionMethod" IS NULL)
        OR ("insurer_product_versions"."inspectionRule" <> 'NOT_REQUIRED' AND "insurer_product_versions"."inspectionTiming" IS NOT NULL AND "insurer_product_versions"."inspectionMethod" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "insurer_products" (
	"id" uuid PRIMARY KEY NOT NULL,
	"insurerId" uuid NOT NULL,
	"code" varchar(80) NOT NULL,
	"createdAt" timestamp (3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "insurer_product_versions" ADD CONSTRAINT "insurer_product_versions_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."insurer_products"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "insurer_product_versions" ADD CONSTRAINT "insurer_product_versions_createdByStaffId_fkey" FOREIGN KEY ("createdByStaffId") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "insurer_product_versions" ADD CONSTRAINT "insurer_product_versions_submittedByStaffId_fkey" FOREIGN KEY ("submittedByStaffId") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "insurer_product_versions" ADD CONSTRAINT "insurer_product_versions_reviewedByStaffId_fkey" FOREIGN KEY ("reviewedByStaffId") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "insurer_product_versions" ADD CONSTRAINT "insurer_product_versions_withdrawnByStaffId_fkey" FOREIGN KEY ("withdrawnByStaffId") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "insurer_products" ADD CONSTRAINT "insurer_products_insurerId_fkey" FOREIGN KEY ("insurerId") REFERENCES "public"."insurers"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "insurer_product_versions_productId_versionNumber_key" ON "insurer_product_versions" USING btree ("productId","versionNumber");--> statement-breakpoint
CREATE INDEX "insurer_product_versions_status_effectiveFrom_idx" ON "insurer_product_versions" USING btree ("status","effectiveFrom");--> statement-breakpoint
CREATE INDEX "insurer_product_versions_productId_status_idx" ON "insurer_product_versions" USING btree ("productId","status");--> statement-breakpoint
CREATE UNIQUE INDEX "insurer_products_insurerId_code_key" ON "insurer_products" USING btree ("insurerId","code");--> statement-breakpoint
CREATE INDEX "insurer_products_insurerId_idx" ON "insurer_products" USING btree ("insurerId");