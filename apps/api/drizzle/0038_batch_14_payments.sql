CREATE TYPE "public"."PaymentProviderName" AS ENUM('STAND_IN');--> statement-breakpoint
CREATE TYPE "public"."ReconciliationKind" AS ENUM('REFUND_REQUIRED', 'AMOUNT_MISMATCH', 'REVERSAL', 'UNMATCHED_PROVIDER_EVENT', 'STATE_CONFLICT', 'ISSUANCE_FAILED', 'ISSUANCE_OVERDUE', 'PENDING_TOO_LONG', 'STATEMENT_UNMATCHED', 'MISSING_FROM_STATEMENT', 'DUPLICATE');--> statement-breakpoint
CREATE TYPE "public"."ReconciliationOutcome" AS ENUM('REFUNDED', 'ADJUSTED', 'ISSUED', 'NO_ACTION', 'WRITTEN_OFF');--> statement-breakpoint
CREATE TYPE "public"."ReconciliationStatus" AS ENUM('OPEN', 'IN_PROGRESS', 'RESOLVED');--> statement-breakpoint
-- The new payment statuses are used by an index predicate below, and the migrator runs every migration in one
-- transaction, where a value added with ADD VALUE cannot be used yet. So the type is rebuilt instead.
ALTER TYPE "public"."PaymentStatus" RENAME TO "PaymentStatus_before_0038";--> statement-breakpoint
CREATE TYPE "public"."PaymentStatus" AS ENUM('PENDING', 'CONFIRMED', 'FAILED', 'INITIATED', 'CANCELLED', 'EXPIRED', 'REVERSED');--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "status" SET DATA TYPE "public"."PaymentStatus" USING "status"::text::"public"."PaymentStatus";--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "status" SET DEFAULT 'PENDING';--> statement-breakpoint
DROP TYPE "public"."PaymentStatus_before_0038";--> statement-breakpoint
ALTER TYPE "public"."PolicyStatus" ADD VALUE 'ISSUANCE_FAILED';--> statement-breakpoint
ALTER TYPE "public"."PolicyStatus" ADD VALUE 'CANCELLED';--> statement-breakpoint
ALTER TYPE "public"."RuleSettingKey" ADD VALUE 'PAYMENT_CHARGES';--> statement-breakpoint
ALTER TYPE "public"."RuleSettingKey" ADD VALUE 'PAYMENT_PENDING_TIMEOUT';--> statement-breakpoint
ALTER TYPE "public"."RuleSettingKey" ADD VALUE 'ISSUANCE_DEADLINE';--> statement-breakpoint
CREATE TABLE "payment_callbacks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider" "PaymentProviderName" NOT NULL,
	"eventId" varchar(200) NOT NULL,
	"eventType" varchar(60) NOT NULL,
	"envelopeHash" varchar(64) NOT NULL,
	"paymentId" uuid,
	"receivedAt" timestamp (3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"processedAt" timestamp (3) with time zone,
	"outcome" varchar(60)
);
--> statement-breakpoint
CREATE TABLE "reconciliation_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" "ReconciliationKind" NOT NULL,
	"status" "ReconciliationStatus" DEFAULT 'OPEN' NOT NULL,
	"outcome" "ReconciliationOutcome",
	"paymentId" uuid,
	"paymentCallbackId" uuid,
	"policyNumber" text,
	"insurerId" uuid,
	"amountMinor" bigint,
	"ownerStaffId" uuid,
	"reason" text NOT NULL,
	"evidenceDocumentIds" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"resolutionNote" text,
	"openedAt" timestamp (3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"resolvedAt" timestamp (3) with time zone,
	"resolvedByStaffId" uuid,
	"updatedAt" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "reconciliation_items_resolution_check" CHECK (("reconciliation_items"."status" = 'RESOLVED') = ("reconciliation_items"."resolvedAt" IS NOT NULL AND "reconciliation_items"."outcome" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "provider" "PaymentProviderName" DEFAULT 'STAND_IN' NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "providerPaymentId" varchar(200);--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "checkoutUrl" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "payerMsisdnMasked" varchar(24);--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "amountBreakdown" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "selectionId" uuid;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "initiatedAt" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "pendingUntil" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "failureCode" varchar(60);--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "reversedAt" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "reversalReference" varchar(200);--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "lastStatusCheckAt" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN "productVersionId" uuid;--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN "issuanceDueAt" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN "issuanceAcceptedAt" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN "issuanceFailedAt" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN "issuanceFailureReason" text;--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN "cancelledAt" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "quote_selections" ADD COLUMN "selectedAddOnCodes" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
-- Before this batch nothing was ever sent to a provider, so a payment left PENDING can never be confirmed.
-- It ends as expired, so it neither blocks a new attempt nor waits on a provider that never heard of it.
UPDATE "payments" SET "status" = 'EXPIRED', "failureCode" = 'NEVER_SENT', "failureReason" = 'Recorded before payments went through a provider.'
WHERE "status" = 'PENDING';--> statement-breakpoint
ALTER TABLE "payment_callbacks" ADD CONSTRAINT "payment_callbacks_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "reconciliation_items" ADD CONSTRAINT "reconciliation_items_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "reconciliation_items" ADD CONSTRAINT "reconciliation_items_paymentCallbackId_fkey" FOREIGN KEY ("paymentCallbackId") REFERENCES "public"."payment_callbacks"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "reconciliation_items" ADD CONSTRAINT "reconciliation_items_policyNumber_fkey" FOREIGN KEY ("policyNumber") REFERENCES "public"."policies"("policyNumber") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "reconciliation_items" ADD CONSTRAINT "reconciliation_items_insurerId_fkey" FOREIGN KEY ("insurerId") REFERENCES "public"."insurers"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "reconciliation_items" ADD CONSTRAINT "reconciliation_items_ownerStaffId_fkey" FOREIGN KEY ("ownerStaffId") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "reconciliation_items" ADD CONSTRAINT "reconciliation_items_resolvedByStaffId_fkey" FOREIGN KEY ("resolvedByStaffId") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_callbacks_provider_eventId_key" ON "payment_callbacks" USING btree ("provider","eventId");--> statement-breakpoint
CREATE INDEX "payment_callbacks_paymentId_idx" ON "payment_callbacks" USING btree ("paymentId");--> statement-breakpoint
CREATE UNIQUE INDEX "reconciliation_items_kind_paymentId_open_key" ON "reconciliation_items" USING btree ("kind","paymentId") WHERE "reconciliation_items"."paymentId" IS NOT NULL AND "reconciliation_items"."status" <> 'RESOLVED';--> statement-breakpoint
CREATE UNIQUE INDEX "reconciliation_items_kind_paymentCallbackId_key" ON "reconciliation_items" USING btree ("kind","paymentCallbackId") WHERE "reconciliation_items"."paymentCallbackId" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "reconciliation_items_status_openedAt_idx" ON "reconciliation_items" USING btree ("status","openedAt");--> statement-breakpoint
CREATE INDEX "reconciliation_items_insurerId_idx" ON "reconciliation_items" USING btree ("insurerId");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_selectionId_fkey" FOREIGN KEY ("selectionId") REFERENCES "public"."quote_selections"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_productVersionId_fkey" FOREIGN KEY ("productVersionId") REFERENCES "public"."insurer_product_versions"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_providerPaymentId_key" ON "payments" USING btree ("provider","providerPaymentId");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_quoteRequestId_open_key" ON "payments" USING btree ("quoteRequestId") WHERE "payments"."status" IN ('INITIATED', 'PENDING');--> statement-breakpoint
CREATE UNIQUE INDEX "payments_quoteRequestId_confirmed_key" ON "payments" USING btree ("quoteRequestId") WHERE "payments"."status" = 'CONFIRMED';--> statement-breakpoint
CREATE INDEX "payments_selectionId_idx" ON "payments" USING btree ("selectionId");--> statement-breakpoint
CREATE INDEX "policies_status_issuanceDueAt_idx" ON "policies" USING btree ("status","issuanceDueAt");--> statement-breakpoint
-- Payments taken before this batch were confirmed on the spot by the stand-in.
-- Their breakdown is the premium they paid plus the RTSA anniversary fee, if any.
UPDATE "payments" SET
  "initiatedAt" = "createdAt",
  "amountBreakdown" = jsonb_build_array(
    jsonb_build_object('kind', 'PREMIUM', 'code', 'PREMIUM', 'label', 'Premium', 'amountMinor', "amountMinor" - "rtsaAnniversaryFeeMinor")
  ) || CASE WHEN "rtsaAnniversaryFeeMinor" > 0 THEN jsonb_build_array(
    jsonb_build_object('kind', 'CHARGE', 'code', 'RTSA_ANNIVERSARY_FEE', 'label', 'RTSA anniversary fee', 'amountMinor', "rtsaAnniversaryFeeMinor")
  ) ELSE '[]'::jsonb END;--> statement-breakpoint
UPDATE "policies" p SET "productVersionId" = q."productVersionId"
FROM "insurer_quotes" q
WHERE q."id" = p."insurerQuoteId" AND q."productVersionId" IS NOT NULL;--> statement-breakpoint
-- A policy still waiting for its certificate gets the default issuance deadline from when it was paid.
UPDATE "policies" SET "issuanceDueAt" = "receivedAt" + interval '48 hours'
WHERE "status" = 'AWAITING_INSURER_CERTIFICATE';--> statement-breakpoint
INSERT INTO "notification_templates" ("id", "key", "channel", "category", "version", "subject", "body", "mandatory", "activeFrom")
VALUES
  (gen_random_uuid(), 'payment.failed', 'IN_APP', 'PAYMENT', 1,
   'Payment not completed',
   'Your payment for {{insurer}} cover did not go through. No money was taken. You can try again while the quote is valid.', true, '1970-01-01T00:00:00Z'),
  (gen_random_uuid(), 'payment.failed', 'EMAIL', 'PAYMENT', 1,
   'Your payment did not go through',
   'Your payment for {{insurer}} cover did not go through and no money was taken. Sign in to InsurShield to try again while the quote is valid.', true, '1970-01-01T00:00:00Z'),
  (gen_random_uuid(), 'payment.expired', 'IN_APP', 'PAYMENT', 1,
   'Payment timed out',
   'We did not hear back about your payment for {{insurer}} cover in time, so it was stopped. No money was taken. You can try again while the quote is valid.', true, '1970-01-01T00:00:00Z'),
  (gen_random_uuid(), 'payment.held', 'IN_APP', 'PAYMENT', 1,
   'Payment received, refund on the way',
   'We received your payment for {{insurer}} cover but could not use it for a policy. Our team will refund it and contact you.', true, '1970-01-01T00:00:00Z'),
  (gen_random_uuid(), 'payment.held', 'EMAIL', 'PAYMENT', 1,
   'About your payment',
   'We received your payment for {{insurer}} cover but could not use it for a policy. Our team will refund it and contact you. Sign in to InsurShield to see its status.', true, '1970-01-01T00:00:00Z');
