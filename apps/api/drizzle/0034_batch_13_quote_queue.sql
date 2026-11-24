CREATE TYPE "public"."QuotePriority" AS ENUM('NORMAL', 'HIGH');--> statement-breakpoint
ALTER TYPE "public"."RuleSettingKey" ADD VALUE 'QUOTE_SLA_WARNING';--> statement-breakpoint
ALTER TABLE "quote_request_product_versions" ADD COLUMN "assignedStaffId" uuid;--> statement-breakpoint
ALTER TABLE "quote_request_product_versions" ADD COLUMN "assignedAt" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "quote_request_product_versions" ADD COLUMN "priority" "QuotePriority" DEFAULT 'NORMAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "quote_request_product_versions" ADD COLUMN "slaWarnedAt" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "quote_request_product_versions" ADD CONSTRAINT "quote_request_product_versions_assignedStaffId_fkey" FOREIGN KEY ("assignedStaffId") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "quote_request_product_versions_assignedStaffId_idx" ON "quote_request_product_versions" USING btree ("assignedStaffId");--> statement-breakpoint
ALTER TABLE "quote_request_product_versions" ADD CONSTRAINT "quote_request_product_versions_assignment_check" CHECK (("quote_request_product_versions"."assignedStaffId" IS NULL) = ("quote_request_product_versions"."assignedAt" IS NULL));