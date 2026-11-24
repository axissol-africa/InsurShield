CREATE TYPE "public"."QuoteStatus" AS ENUM('ACTIVE', 'WITHDRAWN', 'SUPERSEDED');--> statement-breakpoint
CREATE TABLE "quote_selections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"quoteRequestId" text NOT NULL,
	"insurerQuoteId" uuid NOT NULL,
	"customerId" uuid NOT NULL,
	"acceptedConditionCodes" text[] DEFAULT '{}'::text[] NOT NULL,
	"selectedAt" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
DROP INDEX "insurer_quotes_request_product_version_key";--> statement-breakpoint
ALTER TABLE "insurer_quotes" ADD COLUMN "status" "QuoteStatus" DEFAULT 'ACTIVE' NOT NULL;--> statement-breakpoint
ALTER TABLE "insurer_quotes" ADD COLUMN "withdrawnAt" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "insurer_quotes" ADD COLUMN "withdrawnReason" text;--> statement-breakpoint
ALTER TABLE "insurer_quotes" ADD COLUMN "supersededById" uuid;--> statement-breakpoint
ALTER TABLE "insurer_quotes" ADD COLUMN "componentsMinor" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "insurer_quotes" ADD COLUMN "excessMinor" bigint;--> statement-breakpoint
ALTER TABLE "insurer_quotes" ADD COLUMN "addOns" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "insurer_quotes" ADD COLUMN "conditions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "quote_selections" ADD CONSTRAINT "quote_selections_quoteRequestId_fkey" FOREIGN KEY ("quoteRequestId") REFERENCES "public"."quote_requests"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "quote_selections" ADD CONSTRAINT "quote_selections_insurerQuoteId_fkey" FOREIGN KEY ("insurerQuoteId") REFERENCES "public"."insurer_quotes"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "quote_selections" ADD CONSTRAINT "quote_selections_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "quote_selections_quoteRequestId_key" ON "quote_selections" USING btree ("quoteRequestId");--> statement-breakpoint
CREATE INDEX "quote_selections_insurerQuoteId_idx" ON "quote_selections" USING btree ("insurerQuoteId");--> statement-breakpoint
ALTER TABLE "insurer_quotes" ADD CONSTRAINT "insurer_quotes_supersededById_fkey" FOREIGN KEY ("supersededById") REFERENCES "public"."insurer_quotes"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "insurer_quotes_request_product_version_key" ON "insurer_quotes" USING btree ("quoteRequestId","productVersionId") WHERE "insurer_quotes"."productVersionId" IS NOT NULL AND "insurer_quotes"."status" = 'ACTIVE';--> statement-breakpoint
ALTER TABLE "insurer_quotes" ADD CONSTRAINT "insurer_quotes_withdrawn_check" CHECK (("insurer_quotes"."status" = 'WITHDRAWN') = ("insurer_quotes"."withdrawnAt" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "insurer_quotes" ADD CONSTRAINT "insurer_quotes_superseded_check" CHECK ("insurer_quotes"."status" <> 'SUPERSEDED' OR "insurer_quotes"."supersededById" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "insurer_quotes" ADD CONSTRAINT "insurer_quotes_excessMinor_check" CHECK ("insurer_quotes"."excessMinor" >= 0 AND "insurer_quotes"."excessMinor" <= 99999999999999);--> statement-breakpoint
-- A quote the customer is comparing can be withdrawn or replaced before they
-- choose it, and they are told either way.
INSERT INTO "notification_templates" ("id", "key", "channel", "category", "version", "subject", "body", "mandatory", "activeFrom")
VALUES
  (gen_random_uuid(), 'quote.withdrawn', 'IN_APP', 'QUOTE', 1,
   '{{insurer}} withdrew a quote',
   '{{insurer}} withdrew its quote for {{product}} on request {{quoteRequestId}}. It is working on the product again.', true, '1970-01-01T00:00:00Z'),
  (gen_random_uuid(), 'quote.withdrawn', 'EMAIL', 'QUOTE', 1,
   'A quote was withdrawn',
   '{{insurer}} withdrew its quote for {{product}} on request {{quoteRequestId}}. Sign in to InsurShield to see your other products.', true, '1970-01-01T00:00:00Z'),
  (gen_random_uuid(), 'quote.replaced', 'IN_APP', 'QUOTE', 1,
   '{{insurer}} updated a quote',
   '{{insurer}} replaced its quote for {{product}} on request {{quoteRequestId}}. Review the new quote before you choose.', true, '1970-01-01T00:00:00Z'),
  (gen_random_uuid(), 'quote.replaced', 'EMAIL', 'QUOTE', 1,
   'A quote was updated',
   '{{insurer}} replaced its quote for {{product}} on request {{quoteRequestId}}. Sign in to InsurShield to review the new quote.', true, '1970-01-01T00:00:00Z');
