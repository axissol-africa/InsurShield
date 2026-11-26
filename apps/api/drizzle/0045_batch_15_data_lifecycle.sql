ALTER TYPE "public"."QuoteUnavailabilityReason" ADD VALUE 'ACCOUNT_CLOSED';--> statement-breakpoint
ALTER TYPE "public"."RuleSettingKey" ADD VALUE 'ACCOUNT_RETENTION';--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "anonymisedAt" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "deletedAt" timestamp (3) with time zone;--> statement-breakpoint
CREATE INDEX "documents_retentionClass_uploadedAt_idx" ON "documents" USING btree ("retentionClass","uploadedAt") WHERE "documents"."deletedAt" IS NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_anonymised_check" CHECK ("customers"."anonymisedAt" IS NULL OR "customers"."deletedAt" IS NOT NULL);