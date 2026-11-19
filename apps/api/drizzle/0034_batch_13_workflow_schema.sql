CREATE TABLE "inspection_request_products" (
	"id" uuid PRIMARY KEY NOT NULL,
	"inspectionId" text NOT NULL,
	"requestProductId" uuid NOT NULL,
	"stage" "InspectionTiming" NOT NULL,
	"isOpen" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp (3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quote_information_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"requestProductId" uuid NOT NULL,
	"requestedByStaffId" uuid NOT NULL,
	"customerMessage" text NOT NULL,
	"questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"documentKinds" "DocumentKind"[] DEFAULT '{}'::"DocumentKind"[] NOT NULL,
	"dueAt" timestamp (3) with time zone NOT NULL,
	"answeredAt" timestamp (3) with time zone,
	"answers" jsonb,
	"answerDocumentIds" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"createdAt" timestamp (3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "quote_information_requests_customer_message_check" CHECK (length(btrim("quote_information_requests"."customerMessage")) > 0)
);
--> statement-breakpoint
CREATE TABLE "quote_internal_notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"requestProductId" uuid NOT NULL,
	"insurerId" uuid NOT NULL,
	"authorStaffId" uuid NOT NULL,
	"body" text NOT NULL,
	"createdAt" timestamp (3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "quote_internal_notes_body_check" CHECK (length(btrim("quote_internal_notes"."body")) BETWEEN 1 AND 4000)
);
--> statement-breakpoint
CREATE TABLE "quote_selections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"quoteRequestId" text NOT NULL,
	"insurerQuoteId" uuid NOT NULL,
	"selectedAddOnCodes" text[] DEFAULT '{}'::text[] NOT NULL,
	"acceptedConditionCodes" text[] DEFAULT '{}'::text[] NOT NULL,
	"selectedAt" timestamp (3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"customerId" uuid NOT NULL
);
--> statement-breakpoint
DROP INDEX "insurer_quotes_request_product_version_key";--> statement-breakpoint
ALTER TABLE "inspections" ADD COLUMN "purpose" "InspectionPurpose" DEFAULT 'GENERAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "inspections" ADD COLUMN "quoteRequestId" text;--> statement-breakpoint
ALTER TABLE "inspections" ADD COLUMN "method" "InspectionMethod";--> statement-breakpoint
ALTER TABLE "inspections" ADD COLUMN "stage" "InspectionTiming";--> statement-breakpoint
ALTER TABLE "inspections" ADD COLUMN "predecessorId" text;--> statement-breakpoint
ALTER TABLE "inspections" ADD COLUMN "result" varchar(10);--> statement-breakpoint
ALTER TABLE "inspections" ADD COLUMN "resultReason" text;--> statement-breakpoint
ALTER TABLE "inspections" ADD COLUMN "reportDocumentId" uuid;--> statement-breakpoint
ALTER TABLE "inspections" ADD COLUMN "decidedByStaffId" uuid;--> statement-breakpoint
ALTER TABLE "inspections" ADD COLUMN "decidedAt" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "inspections" ADD COLUMN "customerActionText" text;--> statement-breakpoint
ALTER TABLE "insurer_product_versions" ADD COLUMN "reinspectionAllowed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "insurer_quotes" ADD COLUMN "status" "QuoteStatus" DEFAULT 'ACTIVE' NOT NULL;--> statement-breakpoint
ALTER TABLE "insurer_quotes" ADD COLUMN "withdrawnAt" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "insurer_quotes" ADD COLUMN "withdrawnReason" text;--> statement-breakpoint
ALTER TABLE "insurer_quotes" ADD COLUMN "supersededById" uuid;--> statement-breakpoint
ALTER TABLE "insurer_quotes" ADD COLUMN "componentsMinor" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "insurer_quotes" ADD COLUMN "excessMinor" bigint;--> statement-breakpoint
ALTER TABLE "insurer_quotes" ADD COLUMN "addOns" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "insurer_quotes" ADD COLUMN "conditions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "insurer_quotes" ADD COLUMN "termsDocumentId" uuid;--> statement-breakpoint
ALTER TABLE "insurer_quotes" ADD COLUMN "inspectionAction" text;--> statement-breakpoint
-- Existing selections need a durable workflow state before the application can
-- take over future transitions. The seven-day value is the prior code default:
-- earlier requests cannot truthfully be assigned a rule version that did not
-- yet exist in the database.
ALTER TABLE "quote_request_product_versions" ADD COLUMN "status" "QuoteProductStatus";--> statement-breakpoint
ALTER TABLE "quote_request_product_versions" ADD COLUMN "replyDueAt" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "quote_request_product_versions" ADD COLUMN "pausedAt" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "quote_request_product_versions" ADD COLUMN "pausedMs" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "quote_request_product_versions" ADD COLUMN "assignedStaffId" uuid;--> statement-breakpoint
ALTER TABLE "quote_request_product_versions" ADD COLUMN "assignedAt" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "quote_request_product_versions" ADD COLUMN "priority" varchar(10) DEFAULT 'NORMAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "quote_request_product_versions" ADD COLUMN "slaWarnedAt" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "quote_request_product_versions" ADD COLUMN "timedOutAt" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "quote_request_product_versions" ADD COLUMN "declineReasonCode" varchar(80);--> statement-breakpoint
UPDATE "quote_request_product_versions" AS selection
SET
  "status" = CASE
    WHEN selection."cancelledAt" IS NOT NULL THEN 'CANCELLED'::"QuoteProductStatus"
    WHEN EXISTS (
      SELECT 1
      FROM "insurer_quotes" AS quote
      WHERE quote."quoteRequestId" = selection."quoteRequestId"
        AND quote."productVersionId" = selection."productVersionId"
    ) THEN 'QUOTED'::"QuoteProductStatus"
    ELSE 'SUBMITTED'::"QuoteProductStatus"
  END,
  "replyDueAt" = request."submittedAt" + interval '7 days'
FROM "quote_requests" AS request
WHERE request."id" = selection."quoteRequestId";--> statement-breakpoint
ALTER TABLE "quote_request_product_versions" ALTER COLUMN "status" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "quote_request_product_versions" ALTER COLUMN "status" SET DEFAULT 'SUBMITTED';--> statement-breakpoint
ALTER TABLE "quote_request_product_versions" ALTER COLUMN "replyDueAt" SET NOT NULL;--> statement-breakpoint
-- A legacy request has no selected-version rows. Its recipients are the
-- equivalent work items: a request is fully ready only once every active
-- recipient has returned a usable legacy quote.
UPDATE "quote_requests" AS request
SET "status" = CASE
  -- Do not mark malformed historical requests with no usable quote as ready.
  -- A request can only be fully ready after at least one active recipient has
  -- supplied a quote and no active recipient remains unanswered.
  WHEN EXISTS (
    SELECT 1
    FROM "insurer_quotes" AS quote
    WHERE quote."quoteRequestId" = request."id"
      AND quote."productVersionId" IS NULL
      AND quote."unpayableAt" IS NULL
  ) AND NOT EXISTS (
    SELECT 1
    FROM "quote_request_recipients" AS recipient
    WHERE recipient."quoteRequestId" = request."id"
      AND recipient."cancelledAt" IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM "insurer_quotes" AS quote
        WHERE quote."quoteRequestId" = request."id"
          AND quote."insurerId" = recipient."insurerId"
          AND quote."productVersionId" IS NULL
          AND quote."unpayableAt" IS NULL
      )
  ) THEN 'QUOTES_READY'::"QuoteRequestStatus"
  WHEN EXISTS (
    SELECT 1
    FROM "insurer_quotes" AS quote
    WHERE quote."quoteRequestId" = request."id"
      AND quote."productVersionId" IS NULL
      AND quote."unpayableAt" IS NULL
  ) THEN 'PARTIALLY_READY'::"QuoteRequestStatus"
  ELSE request."status"
END
WHERE request."model" = 'LEGACY'
  AND request."status" = 'QUOTED';--> statement-breakpoint
ALTER TABLE "inspection_request_products" ADD CONSTRAINT "inspection_request_products_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "public"."inspections"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "inspection_request_products" ADD CONSTRAINT "inspection_request_products_requestProductId_fkey" FOREIGN KEY ("requestProductId") REFERENCES "public"."quote_request_product_versions"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "quote_information_requests" ADD CONSTRAINT "quote_information_requests_requestProductId_fkey" FOREIGN KEY ("requestProductId") REFERENCES "public"."quote_request_product_versions"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "quote_information_requests" ADD CONSTRAINT "quote_information_requests_requestedByStaffId_fkey" FOREIGN KEY ("requestedByStaffId") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "quote_internal_notes" ADD CONSTRAINT "quote_internal_notes_requestProductId_fkey" FOREIGN KEY ("requestProductId") REFERENCES "public"."quote_request_product_versions"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "quote_internal_notes" ADD CONSTRAINT "quote_internal_notes_insurerId_fkey" FOREIGN KEY ("insurerId") REFERENCES "public"."insurers"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "quote_internal_notes" ADD CONSTRAINT "quote_internal_notes_authorStaffId_fkey" FOREIGN KEY ("authorStaffId") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "quote_selections" ADD CONSTRAINT "quote_selections_quoteRequestId_fkey" FOREIGN KEY ("quoteRequestId") REFERENCES "public"."quote_requests"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "quote_selections" ADD CONSTRAINT "quote_selections_insurerQuoteId_fkey" FOREIGN KEY ("insurerQuoteId") REFERENCES "public"."insurer_quotes"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "quote_selections" ADD CONSTRAINT "quote_selections_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "inspection_request_products_inspection_product_key" ON "inspection_request_products" USING btree ("inspectionId","requestProductId");--> statement-breakpoint
CREATE UNIQUE INDEX "inspection_request_products_one_open_product_stage_key" ON "inspection_request_products" USING btree ("requestProductId","stage") WHERE "inspection_request_products"."isOpen";--> statement-breakpoint
CREATE INDEX "inspection_request_products_inspectionId_idx" ON "inspection_request_products" USING btree ("inspectionId");--> statement-breakpoint
CREATE INDEX "quote_information_requests_requestProductId_createdAt_idx" ON "quote_information_requests" USING btree ("requestProductId","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "quote_information_requests_one_open_per_product_key" ON "quote_information_requests" USING btree ("requestProductId") WHERE "quote_information_requests"."answeredAt" IS NULL;--> statement-breakpoint
CREATE INDEX "quote_internal_notes_requestProductId_createdAt_idx" ON "quote_internal_notes" USING btree ("requestProductId","createdAt");--> statement-breakpoint
CREATE INDEX "quote_internal_notes_insurerId_createdAt_idx" ON "quote_internal_notes" USING btree ("insurerId","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "quote_selections_quoteRequestId_key" ON "quote_selections" USING btree ("quoteRequestId");--> statement-breakpoint
CREATE UNIQUE INDEX "quote_selections_insurerQuoteId_key" ON "quote_selections" USING btree ("insurerQuoteId");--> statement-breakpoint
CREATE INDEX "quote_selections_customerId_selectedAt_idx" ON "quote_selections" USING btree ("customerId","selectedAt");--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_quoteRequestId_fkey" FOREIGN KEY ("quoteRequestId") REFERENCES "public"."quote_requests"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_predecessorId_fkey" FOREIGN KEY ("predecessorId") REFERENCES "public"."inspections"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_reportDocumentId_fkey" FOREIGN KEY ("reportDocumentId") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_decidedByStaffId_fkey" FOREIGN KEY ("decidedByStaffId") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "insurer_quotes" ADD CONSTRAINT "insurer_quotes_termsDocumentId_fkey" FOREIGN KEY ("termsDocumentId") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "insurer_quotes" ADD CONSTRAINT "insurer_quotes_supersededById_fkey" FOREIGN KEY ("supersededById") REFERENCES "public"."insurer_quotes"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "quote_request_product_versions" ADD CONSTRAINT "quote_request_product_versions_assignedStaffId_fkey" FOREIGN KEY ("assignedStaffId") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "inspections_insurerId_status_stage_idx" ON "inspections" USING btree ("insurerId","status","stage");--> statement-breakpoint
CREATE INDEX "inspections_quoteRequestId_status_idx" ON "inspections" USING btree ("quoteRequestId","status");--> statement-breakpoint
CREATE INDEX "insurer_quotes_status_validUntil_idx" ON "insurer_quotes" USING btree ("status","validUntil");--> statement-breakpoint
CREATE UNIQUE INDEX "insurer_quotes_active_request_product_version_key" ON "insurer_quotes" USING btree ("quoteRequestId","productVersionId") WHERE "insurer_quotes"."productVersionId" IS NOT NULL AND "insurer_quotes"."status" = 'ACTIVE';--> statement-breakpoint
CREATE INDEX "quote_request_product_versions_insurerId_status_replyDueAt_idx" ON "quote_request_product_versions" USING btree ("insurerId","status","replyDueAt");--> statement-breakpoint
CREATE INDEX "quote_request_product_versions_assignedStaffId_status_idx" ON "quote_request_product_versions" USING btree ("assignedStaffId","status");--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_result_check" CHECK ("inspections"."result" IS NULL OR "inspections"."result" IN ('PASSED', 'FAILED'));--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_underwriting_shape_check" CHECK (("inspections"."purpose" = 'GENERAL' AND "inspections"."quoteRequestId" IS NULL AND "inspections"."method" IS NULL AND "inspections"."stage" IS NULL)
        OR ("inspections"."purpose" = 'UNDERWRITING' AND "inspections"."quoteRequestId" IS NOT NULL AND "inspections"."insurerId" IS NOT NULL AND "inspections"."method" IS NOT NULL AND "inspections"."stage" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "insurer_quotes" ADD CONSTRAINT "insurer_quotes_withdrawal_mark_check" CHECK (("insurer_quotes"."status" = 'WITHDRAWN') = ("insurer_quotes"."withdrawnAt" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "insurer_quotes" ADD CONSTRAINT "insurer_quotes_superseded_mark_check" CHECK (("insurer_quotes"."supersededById" IS NULL OR "insurer_quotes"."status" = 'SUPERSEDED') AND "insurer_quotes"."supersededById" IS DISTINCT FROM "insurer_quotes"."id");--> statement-breakpoint
ALTER TABLE "quote_request_product_versions" ADD CONSTRAINT "quote_request_product_versions_priority_check" CHECK ("quote_request_product_versions"."priority" IN ('NORMAL', 'HIGH'));--> statement-breakpoint
ALTER TABLE "quote_request_product_versions" ADD CONSTRAINT "quote_request_product_versions_paused_ms_check" CHECK ("quote_request_product_versions"."pausedMs" >= 0);--> statement-breakpoint
-- Underwriting notes are operational evidence. A database trigger protects
-- append-only behaviour even if a future repository accidentally exposes an
-- update or delete method.
REVOKE UPDATE, DELETE ON TABLE "quote_internal_notes" FROM PUBLIC;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.quote_internal_notes_reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'quote_internal_notes is append-only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER quote_internal_notes_append_only
BEFORE UPDATE OR DELETE ON public.quote_internal_notes
FOR EACH ROW
EXECUTE FUNCTION public.quote_internal_notes_reject_mutation();--> statement-breakpoint
-- A note must belong to the insurer that owns the selected product. The
-- foreign keys prove each side exists; this trigger proves the tenant boundary.
CREATE OR REPLACE FUNCTION public.enforce_quote_internal_note_insurer()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  owner_insurer_id uuid;
BEGIN
  SELECT "insurerId" INTO owner_insurer_id
  FROM public.quote_request_product_versions
  WHERE id = NEW."requestProductId";

  IF owner_insurer_id IS NULL OR owner_insurer_id <> NEW."insurerId" THEN
    RAISE EXCEPTION 'quote internal note insurer must own selected product'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER quote_internal_note_insurer_guard
BEFORE INSERT OR UPDATE OF "requestProductId", "insurerId"
ON public.quote_internal_notes
FOR EACH ROW
EXECUTE FUNCTION public.enforce_quote_internal_note_insurer();
