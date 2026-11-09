CREATE TYPE "public"."DocumentRetentionClass" AS ENUM('UNDERWRITING_EVIDENCE', 'POLICY_EVIDENCE', 'CLAIM_EVIDENCE', 'BRAND_ASSET');--> statement-breakpoint
CREATE TYPE "public"."DocumentScanStatus" AS ENUM('UNSCANNED', 'CLEAN');--> statement-breakpoint
-- Documents stored before this migration were never scanned. They stay
-- UNSCANNED, and the API refuses to hand out a download link for them, rather
-- than recording a scan that never happened.
ALTER TABLE "documents" ADD COLUMN "scanStatus" "DocumentScanStatus" DEFAULT 'UNSCANNED' NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "scannedAt" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "scannerName" text;--> statement-breakpoint
-- Added nullable, backfilled from the kind each row already has, then made
-- NOT NULL: a document is never left without the class that decides how long
-- it is kept. The mapping matches src/documents/domain/retention.ts.
ALTER TABLE "documents" ADD COLUMN "retentionClass" "DocumentRetentionClass";--> statement-breakpoint
-- Compared as text: a value added to DocumentKind by an earlier migration
-- cannot be named as an enum literal in the same transaction that added it.
UPDATE "documents" SET "retentionClass" = CASE "kind"::text
	WHEN 'QUOTATION' THEN 'UNDERWRITING_EVIDENCE'
	WHEN 'WHITE_BOOK' THEN 'UNDERWRITING_EVIDENCE'
	WHEN 'INSPECTION_PHOTO' THEN 'UNDERWRITING_EVIDENCE'
	WHEN 'CERTIFICATE' THEN 'POLICY_EVIDENCE'
	WHEN 'CLAIM_ATTACHMENT' THEN 'CLAIM_EVIDENCE'
	WHEN 'NCD_EVIDENCE' THEN 'CLAIM_EVIDENCE'
	WHEN 'INSURER_LOGO' THEN 'BRAND_ASSET'
END::"public"."DocumentRetentionClass" WHERE "retentionClass" IS NULL;--> statement-breakpoint
ALTER TABLE "documents" ALTER COLUMN "retentionClass" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "documents_scanStatus_idx" ON "documents" USING btree ("scanStatus");
