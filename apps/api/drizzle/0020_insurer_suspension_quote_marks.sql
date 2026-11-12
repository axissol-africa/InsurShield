-- Suspension stops new sales without corrupting operational delivery history.
--
-- `status` on a recipient still answers whether delivery worked; a final quote
-- still records the price and expiry the insurer sent. The two marks below say
-- that an otherwise historical item can no longer become new business.
CREATE TYPE "public"."QuoteUnavailabilityReason" AS ENUM('INSURER_SUSPENDED');--> statement-breakpoint
ALTER TABLE "quote_request_recipients" ADD COLUMN "cancelledAt" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "quote_request_recipients" ADD COLUMN "cancelledReason" "QuoteUnavailabilityReason";--> statement-breakpoint
ALTER TABLE "insurer_quotes" ADD COLUMN "unpayableAt" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "insurer_quotes" ADD COLUMN "unpayableReason" "QuoteUnavailabilityReason";--> statement-breakpoint
ALTER TABLE "quote_request_recipients" ADD CONSTRAINT "quote_request_recipients_cancellation_mark_check" CHECK (("cancelledAt" IS NULL) = ("cancelledReason" IS NULL));--> statement-breakpoint
ALTER TABLE "insurer_quotes" ADD CONSTRAINT "insurer_quotes_unpayable_mark_check" CHECK (("unpayableAt" IS NULL) = ("unpayableReason" IS NULL));--> statement-breakpoint
CREATE INDEX "quote_request_recipients_insurerId_cancelledAt_idx" ON "quote_request_recipients" USING btree ("insurerId", "cancelledAt");--> statement-breakpoint
CREATE INDEX "insurer_quotes_insurerId_unpayableAt_idx" ON "insurer_quotes" USING btree ("insurerId", "unpayableAt");--> statement-breakpoint

-- These notices intentionally say only that the insurer is unavailable. A
-- customer should know their request changed, not the private reason for an
-- insurer's regulatory suspension.
INSERT INTO "notification_templates" ("id", "key", "channel", "category", "version", "subject", "body", "mandatory", "activeFrom")
VALUES
  (gen_random_uuid(), 'quote.cancelled', 'IN_APP', 'QUOTE', 1,
   'An insurer is unavailable for your quote request',
   '{{insurer}} is currently unavailable for quote request {{quoteRequestId}}. Any other insurer responses are unaffected.', true, '1970-01-01T00:00:00Z'),
  (gen_random_uuid(), 'quote.cancelled', 'EMAIL', 'QUOTE', 1,
   'Update to your quote request',
   '{{insurer}} is currently unavailable for quote request {{quoteRequestId}}. Sign in to InsurShield to review the remaining options.', true, '1970-01-01T00:00:00Z');
