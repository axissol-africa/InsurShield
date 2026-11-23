CREATE TYPE "public"."QuoteProductStatus" AS ENUM('SUBMITTED', 'INSURER_PROCESSING', 'VERIFICATION_REQUIRED', 'INSPECTION_REQUIRED', 'QUOTED', 'DECLINED', 'TIMED_OUT', 'EXPIRED', 'CANCELLED', 'MANUAL_REVIEW');--> statement-breakpoint
ALTER TYPE "public"."RuleSettingKey" ADD VALUE 'QUOTE_DECLINE_REASONS';--> statement-breakpoint
CREATE TABLE "quote_information_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"quoteRequestId" text NOT NULL,
	"productVersionId" uuid NOT NULL,
	"insurerId" uuid NOT NULL,
	"requestedByStaffId" uuid,
	"message" text NOT NULL,
	"dueAt" timestamp (3) with time zone NOT NULL,
	"createdAt" timestamp (3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"answeredAt" timestamp (3) with time zone,
	"answerText" text,
	"closedAt" timestamp (3) with time zone,
	CONSTRAINT "quote_information_requests_answer_check" CHECK (("quote_information_requests"."answeredAt" IS NULL) = ("quote_information_requests"."answerText" IS NULL)
        AND ("quote_information_requests"."answeredAt" IS NULL OR "quote_information_requests"."closedAt" IS NOT NULL)),
	CONSTRAINT "quote_information_requests_message_check" CHECK (char_length("quote_information_requests"."message") BETWEEN 1 AND 2000)
);
--> statement-breakpoint
CREATE TABLE "quote_internal_notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"quoteRequestId" text NOT NULL,
	"productVersionId" uuid NOT NULL,
	"insurerId" uuid NOT NULL,
	"authorStaffId" uuid,
	"body" text NOT NULL,
	"createdAt" timestamp (3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "quote_internal_notes_body_check" CHECK (char_length("quote_internal_notes"."body") BETWEEN 1 AND 4000)
);
--> statement-breakpoint
ALTER TABLE "quote_request_product_versions" ADD COLUMN "status" "QuoteProductStatus" DEFAULT 'SUBMITTED' NOT NULL;--> statement-breakpoint
ALTER TABLE "quote_request_product_versions" ADD COLUMN "statusChangedAt" timestamp (3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL;--> statement-breakpoint
ALTER TABLE "quote_request_product_versions" ADD COLUMN "replyDueAt" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "quote_request_product_versions" ADD COLUMN "pausedAt" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "quote_request_product_versions" ADD COLUMN "declineReasonCode" varchar(80);--> statement-breakpoint
ALTER TABLE "quote_request_product_versions" ADD COLUMN "declineCustomerNote" text;--> statement-breakpoint
-- Every existing chosen version gets the state its facts already say. A version
-- with a final quote is QUOTED, unless decision 24 cancelled it before it was
-- paid; a cancelled version without a quote is CANCELLED; the rest are waiting.
-- A version whose rule needs an inspection before quotation waits for one with
-- its reply clock stopped, so it is never quoted against its own rule.
UPDATE "quote_request_product_versions" AS v
SET "status" = (CASE
      WHEN q."id" IS NOT NULL AND (v."cancelledAt" IS NULL OR p."id" IS NOT NULL) THEN 'QUOTED'
      WHEN v."cancelledAt" IS NOT NULL THEN 'CANCELLED'
      WHEN v."inspectionRule" = 'REQUIRED' AND v."inspectionTiming" = 'BEFORE_QUOTATION' THEN 'INSPECTION_REQUIRED'
      ELSE 'SUBMITTED'
    END)::"QuoteProductStatus",
  "statusChangedAt" = CASE
      WHEN q."id" IS NOT NULL AND (v."cancelledAt" IS NULL OR p."id" IS NOT NULL) THEN q."sentAt"
      WHEN v."cancelledAt" IS NOT NULL THEN v."cancelledAt"
      ELSE v."selectedAt"
    END,
  "pausedAt" = CASE
      WHEN q."id" IS NULL AND v."cancelledAt" IS NULL
        AND v."inspectionRule" = 'REQUIRED' AND v."inspectionTiming" = 'BEFORE_QUOTATION' THEN CURRENT_TIMESTAMP
    END,
  "replyDueAt" = r."expiresAt"
FROM "quote_requests" AS r,
  "quote_request_product_versions" AS self
  LEFT JOIN "insurer_quotes" AS q
    ON q."quoteRequestId" = self."quoteRequestId" AND q."productVersionId" = self."productVersionId"
  LEFT JOIN "payments" AS p
    ON p."insurerQuoteId" = q."id" AND p."status" = 'CONFIRMED'
WHERE self."id" = v."id" AND r."id" = v."quoteRequestId";--> statement-breakpoint
ALTER TABLE "quote_information_requests" ADD CONSTRAINT "quote_information_requests_selection_fkey" FOREIGN KEY ("quoteRequestId","productVersionId") REFERENCES "public"."quote_request_product_versions"("quoteRequestId","productVersionId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_information_requests" ADD CONSTRAINT "quote_information_requests_insurerId_fkey" FOREIGN KEY ("insurerId") REFERENCES "public"."insurers"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "quote_information_requests" ADD CONSTRAINT "quote_information_requests_requestedByStaffId_fkey" FOREIGN KEY ("requestedByStaffId") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "quote_internal_notes" ADD CONSTRAINT "quote_internal_notes_selection_fkey" FOREIGN KEY ("quoteRequestId","productVersionId") REFERENCES "public"."quote_request_product_versions"("quoteRequestId","productVersionId") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_internal_notes" ADD CONSTRAINT "quote_internal_notes_insurerId_fkey" FOREIGN KEY ("insurerId") REFERENCES "public"."insurers"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "quote_internal_notes" ADD CONSTRAINT "quote_internal_notes_authorStaffId_fkey" FOREIGN KEY ("authorStaffId") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "quote_information_requests_open_key" ON "quote_information_requests" USING btree ("quoteRequestId","productVersionId") WHERE "quote_information_requests"."closedAt" IS NULL;--> statement-breakpoint
CREATE INDEX "quote_information_requests_insurerId_createdAt_idx" ON "quote_information_requests" USING btree ("insurerId","createdAt");--> statement-breakpoint
CREATE INDEX "quote_internal_notes_selection_createdAt_idx" ON "quote_internal_notes" USING btree ("quoteRequestId","productVersionId","createdAt");--> statement-breakpoint
CREATE INDEX "quote_request_product_versions_status_replyDueAt_idx" ON "quote_request_product_versions" USING btree ("status","replyDueAt");--> statement-breakpoint
ALTER TABLE "quote_request_product_versions" ADD CONSTRAINT "quote_request_product_versions_decline_check" CHECK (("quote_request_product_versions"."status" = 'DECLINED') = ("quote_request_product_versions"."declineReasonCode" IS NOT NULL)
        AND ("quote_request_product_versions"."declineCustomerNote" IS NULL OR "quote_request_product_versions"."declineReasonCode" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "quote_request_product_versions" ADD CONSTRAINT "quote_request_product_versions_cancelled_check" CHECK ("quote_request_product_versions"."status" <> 'CANCELLED' OR "quote_request_product_versions"."cancelledAt" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "quote_request_product_versions" ADD CONSTRAINT "quote_request_product_versions_paused_check" CHECK ("quote_request_product_versions"."pausedAt" IS NULL OR "quote_request_product_versions"."status" IN ('VERIFICATION_REQUIRED', 'INSPECTION_REQUIRED'));--> statement-breakpoint
-- Internal notes are a record of what the insurer knew and when. Like
-- audit_logs, they may be added to but never edited or removed.
REVOKE UPDATE, DELETE ON TABLE "quote_internal_notes" FROM PUBLIC;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "quote_internal_notes_reject_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'quote_internal_notes is append-only' USING ERRCODE = '55000';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "quote_internal_notes_append_only"
BEFORE UPDATE OR DELETE ON "quote_internal_notes"
FOR EACH ROW EXECUTE FUNCTION "quote_internal_notes_reject_mutation"();--> statement-breakpoint
-- Each chosen product now has its own outcome, so the customer is told about
-- each one. A decline names the approved customer wording, never the internal
-- reason. All are mandatory: they decide whether the customer can buy cover.
INSERT INTO "notification_templates" ("id", "key", "channel", "category", "version", "subject", "body", "mandatory", "activeFrom")
VALUES
  (gen_random_uuid(), 'quote.version_declined', 'IN_APP', 'QUOTE', 1,
   '{{insurer}} declined to quote',
   '{{insurer}} will not quote {{product}} on request {{quoteRequestId}}. {{reason}}', true, '1970-01-01T00:00:00Z'),
  (gen_random_uuid(), 'quote.version_declined', 'EMAIL', 'QUOTE', 1,
   'Update to your quote request',
   '{{insurer}} will not quote {{product}} on request {{quoteRequestId}}. {{reason}} Sign in to InsurShield to see your other products.', true, '1970-01-01T00:00:00Z'),
  (gen_random_uuid(), 'quote.information_requested', 'IN_APP', 'QUOTE', 1,
   '{{insurer}} needs more information',
   '{{insurer}} needs more information to quote {{product}} on request {{quoteRequestId}}. Please answer by {{dueDate}}.', true, '1970-01-01T00:00:00Z'),
  (gen_random_uuid(), 'quote.information_requested', 'EMAIL', 'QUOTE', 1,
   'An insurer needs more information',
   '{{insurer}} needs more information to quote {{product}} on request {{quoteRequestId}}. Sign in to InsurShield and answer by {{dueDate}}.', true, '1970-01-01T00:00:00Z'),
  (gen_random_uuid(), 'quote.version_timed_out', 'IN_APP', 'QUOTE', 1,
   '{{insurer}} did not respond in time',
   '{{insurer}} did not send a quote for {{product}} on request {{quoteRequestId}} in time. You can request fresh quotes.', true, '1970-01-01T00:00:00Z'),
  (gen_random_uuid(), 'quote.version_timed_out', 'EMAIL', 'QUOTE', 1,
   'An insurer did not respond in time',
   '{{insurer}} did not send a quote for {{product}} on request {{quoteRequestId}} in time. Sign in to InsurShield to see your other products or request fresh quotes.', true, '1970-01-01T00:00:00Z'),
  (gen_random_uuid(), 'quote.expired', 'IN_APP', 'QUOTE', 1,
   'A quote has expired',
   'The quote from {{insurer}} for {{product}} on request {{quoteRequestId}} has expired.', true, '1970-01-01T00:00:00Z'),
  (gen_random_uuid(), 'quote.expired', 'EMAIL', 'QUOTE', 1,
   'A quote has expired',
   'The quote from {{insurer}} for {{product}} on request {{quoteRequestId}} has expired. Sign in to InsurShield to request fresh quotes.', true, '1970-01-01T00:00:00Z');
