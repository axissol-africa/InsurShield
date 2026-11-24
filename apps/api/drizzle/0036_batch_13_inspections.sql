CREATE TYPE "public"."InspectionPurpose" AS ENUM('GENERAL', 'UNDERWRITING');--> statement-breakpoint
CREATE TYPE "public"."InspectionResult" AS ENUM('PASSED', 'FAILED');--> statement-breakpoint
ALTER TYPE "public"."InspectionStatus" ADD VALUE 'CANCELLED';--> statement-breakpoint
ALTER TYPE "public"."InspectionStatus" ADD VALUE 'NO_SHOW';--> statement-breakpoint
CREATE TABLE "inspection_request_products" (
	"id" uuid PRIMARY KEY NOT NULL,
	"inspectionId" text NOT NULL,
	"quoteRequestId" text NOT NULL,
	"productVersionId" uuid NOT NULL,
	"stage" "InspectionTiming" NOT NULL,
	"isOpen" boolean DEFAULT true NOT NULL,
	"passed" boolean DEFAULT false NOT NULL,
	CONSTRAINT "inspection_request_products_passed_check" CHECK (NOT ("inspection_request_products"."passed" AND "inspection_request_products"."isOpen"))
);
--> statement-breakpoint
ALTER TABLE "inspections" ADD COLUMN "purpose" "InspectionPurpose" DEFAULT 'GENERAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "inspections" ADD COLUMN "quoteRequestId" text;--> statement-breakpoint
ALTER TABLE "inspections" ADD COLUMN "method" "InspectionMethod";--> statement-breakpoint
ALTER TABLE "inspections" ADD COLUMN "stage" "InspectionTiming";--> statement-breakpoint
ALTER TABLE "inspections" ADD COLUMN "predecessorId" text;--> statement-breakpoint
ALTER TABLE "inspections" ADD COLUMN "result" "InspectionResult";--> statement-breakpoint
ALTER TABLE "inspections" ADD COLUMN "resultReason" text;--> statement-breakpoint
ALTER TABLE "inspections" ADD COLUMN "decidedByStaffId" uuid;--> statement-breakpoint
ALTER TABLE "inspections" ADD COLUMN "decidedAt" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "insurer_product_versions" ADD COLUMN "reinspectionAllowed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "inspection_request_products" ADD CONSTRAINT "inspection_request_products_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "public"."inspections"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "inspection_request_products" ADD CONSTRAINT "inspection_request_products_selection_fkey" FOREIGN KEY ("quoteRequestId","productVersionId") REFERENCES "public"."quote_request_product_versions"("quoteRequestId","productVersionId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inspection_request_products_inspection_version_key" ON "inspection_request_products" USING btree ("inspectionId","productVersionId");--> statement-breakpoint
CREATE UNIQUE INDEX "inspection_request_products_open_key" ON "inspection_request_products" USING btree ("quoteRequestId","productVersionId","stage") WHERE "inspection_request_products"."isOpen";--> statement-breakpoint
CREATE INDEX "inspection_request_products_selection_idx" ON "inspection_request_products" USING btree ("quoteRequestId","productVersionId");--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_quoteRequestId_fkey" FOREIGN KEY ("quoteRequestId") REFERENCES "public"."quote_requests"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_predecessorId_fkey" FOREIGN KEY ("predecessorId") REFERENCES "public"."inspections"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_decidedByStaffId_fkey" FOREIGN KEY ("decidedByStaffId") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "inspections_insurerId_status_idx" ON "inspections" USING btree ("insurerId","status");--> statement-breakpoint
CREATE INDEX "inspections_quoteRequestId_idx" ON "inspections" USING btree ("quoteRequestId");--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_underwriting_check" CHECK ("inspections"."purpose" <> 'UNDERWRITING' OR ("inspections"."quoteRequestId" IS NOT NULL AND "inspections"."method" IS NOT NULL AND "inspections"."stage" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_result_check" CHECK (("inspections"."result" IS NULL) = ("inspections"."decidedAt" IS NULL));--> statement-breakpoint
-- The customer follows an inspection a chosen product needs. None of these
-- names the reason for a fail; the customer reads it in their account.
INSERT INTO "notification_templates" ("id", "key", "channel", "category", "version", "subject", "body", "mandatory", "activeFrom")
VALUES
  (gen_random_uuid(), 'inspection.scheduled', 'IN_APP', 'INSPECTION', 1,
   'Inspection booked',
   'The inspection of {{vehicle}} is booked for {{date}}. You can see the details in your account.', true, '1970-01-01T00:00:00Z'),
  (gen_random_uuid(), 'inspection.scheduled', 'EMAIL', 'INSPECTION', 1,
   'Your vehicle inspection is booked',
   'The inspection of {{vehicle}} is booked for {{date}}. Sign in to InsurShield to see where and who will inspect it.', true, '1970-01-01T00:00:00Z'),
  (gen_random_uuid(), 'inspection.approved', 'IN_APP', 'INSPECTION', 1,
   'Inspection passed',
   '{{vehicle}} passed its inspection. The insurer can now go ahead with your quote.', true, '1970-01-01T00:00:00Z'),
  (gen_random_uuid(), 'inspection.approved', 'EMAIL', 'INSPECTION', 1,
   'Your vehicle passed its inspection',
   '{{vehicle}} passed its inspection. Sign in to InsurShield to follow your quotes.', true, '1970-01-01T00:00:00Z'),
  (gen_random_uuid(), 'inspection.failed', 'IN_APP', 'INSPECTION', 1,
   'Inspection result',
   '{{vehicle}} did not pass its inspection. You can see what happens next in your account.', true, '1970-01-01T00:00:00Z'),
  (gen_random_uuid(), 'inspection.failed', 'EMAIL', 'INSPECTION', 1,
   'Your vehicle inspection result',
   '{{vehicle}} did not pass its inspection. Sign in to InsurShield to see what happens next.', true, '1970-01-01T00:00:00Z'),
  (gen_random_uuid(), 'inspection.rebooked', 'IN_APP', 'INSPECTION', 1,
   'A new inspection is needed',
   'A new inspection of {{vehicle}} is needed. The insurer will contact you to book it.', true, '1970-01-01T00:00:00Z'),
  (gen_random_uuid(), 'inspection.rebooked', 'EMAIL', 'INSPECTION', 1,
   'A new vehicle inspection is needed',
   'A new inspection of {{vehicle}} is needed. The insurer will contact you to book it. Sign in to InsurShield to follow it.', true, '1970-01-01T00:00:00Z');
