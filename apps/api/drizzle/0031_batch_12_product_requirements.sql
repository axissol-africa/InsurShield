CREATE TABLE "product_version_requirements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"productVersionId" uuid NOT NULL,
	"key" varchar(80) NOT NULL,
	"kind" varchar(20) NOT NULL,
	"label" text NOT NULL,
	"helpText" text,
	"required" boolean DEFAULT true NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"displayOrder" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp (3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "product_version_requirements_display_order_check" CHECK ("product_version_requirements"."displayOrder" >= 0),
	CONSTRAINT "product_version_requirements_kind_check" CHECK ("product_version_requirements"."kind" IN ('QUESTION', 'DOCUMENT', 'DECLARATION')),
	CONSTRAINT "product_version_requirements_config_object_check" CHECK (jsonb_typeof("product_version_requirements"."config") = 'object')
);
--> statement-breakpoint
CREATE TABLE "quote_request_product_requirement_answers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"quoteRequestId" text NOT NULL,
	"productVersionId" uuid NOT NULL,
	"requirementKey" varchar(80) NOT NULL,
	"value" jsonb NOT NULL,
	"createdAt" timestamp (3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quote_request_product_requirement_declarations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"quoteRequestId" text NOT NULL,
	"productVersionId" uuid NOT NULL,
	"requirementKey" varchar(80) NOT NULL,
	"acceptedAt" timestamp (3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quote_request_product_requirement_documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"quoteRequestId" text NOT NULL,
	"productVersionId" uuid NOT NULL,
	"requirementKey" varchar(80) NOT NULL,
	"documentId" uuid NOT NULL,
	"createdAt" timestamp (3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_version_requirements" ADD CONSTRAINT "product_version_requirements_productVersionId_fkey" FOREIGN KEY ("productVersionId") REFERENCES "public"."insurer_product_versions"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "quote_request_product_requirement_answers" ADD CONSTRAINT "quote_request_requirement_answers_request_fkey" FOREIGN KEY ("quoteRequestId") REFERENCES "public"."quote_requests"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "quote_request_product_requirement_answers" ADD CONSTRAINT "quote_request_requirement_answers_selection_fkey" FOREIGN KEY ("quoteRequestId","productVersionId") REFERENCES "public"."quote_request_product_versions"("quoteRequestId","productVersionId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_request_product_requirement_declarations" ADD CONSTRAINT "quote_request_requirement_declarations_request_fkey" FOREIGN KEY ("quoteRequestId") REFERENCES "public"."quote_requests"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "quote_request_product_requirement_declarations" ADD CONSTRAINT "quote_request_requirement_declarations_selection_fkey" FOREIGN KEY ("quoteRequestId","productVersionId") REFERENCES "public"."quote_request_product_versions"("quoteRequestId","productVersionId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_request_product_requirement_documents" ADD CONSTRAINT "quote_request_requirement_documents_request_fkey" FOREIGN KEY ("quoteRequestId") REFERENCES "public"."quote_requests"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "quote_request_product_requirement_documents" ADD CONSTRAINT "quote_request_requirement_documents_document_fkey" FOREIGN KEY ("documentId") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "quote_request_product_requirement_documents" ADD CONSTRAINT "quote_request_requirement_documents_selection_fkey" FOREIGN KEY ("quoteRequestId","productVersionId") REFERENCES "public"."quote_request_product_versions"("quoteRequestId","productVersionId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "product_version_requirements_version_key" ON "product_version_requirements" USING btree ("productVersionId","key");--> statement-breakpoint
CREATE INDEX "product_version_requirements_version_order_idx" ON "product_version_requirements" USING btree ("productVersionId","displayOrder");--> statement-breakpoint
CREATE UNIQUE INDEX "quote_request_requirement_answers_request_version_key" ON "quote_request_product_requirement_answers" USING btree ("quoteRequestId","productVersionId","requirementKey");--> statement-breakpoint
CREATE INDEX "quote_request_requirement_answers_request_idx" ON "quote_request_product_requirement_answers" USING btree ("quoteRequestId");--> statement-breakpoint
CREATE UNIQUE INDEX "quote_request_requirement_declarations_request_version_key" ON "quote_request_product_requirement_declarations" USING btree ("quoteRequestId","productVersionId","requirementKey");--> statement-breakpoint
CREATE INDEX "quote_request_requirement_declarations_request_idx" ON "quote_request_product_requirement_declarations" USING btree ("quoteRequestId");--> statement-breakpoint
CREATE UNIQUE INDEX "quote_request_requirement_documents_request_version_key" ON "quote_request_product_requirement_documents" USING btree ("quoteRequestId","productVersionId","requirementKey");--> statement-breakpoint
CREATE INDEX "quote_request_requirement_documents_request_idx" ON "quote_request_product_requirement_documents" USING btree ("quoteRequestId");--> statement-breakpoint
CREATE INDEX "quote_request_requirement_documents_document_idx" ON "quote_request_product_requirement_documents" USING btree ("documentId");
--> statement-breakpoint
-- Drizzle describes relational columns and indexes above. These guards cover
-- the cross-table business invariant that PostgreSQL cannot express as a
-- declarative foreign key: a quote must use the exact selected product version
-- and the insurer that owns it.
CREATE OR REPLACE FUNCTION public.enforce_quote_request_selection_insurer()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  owner_insurer_id uuid;
BEGIN
  SELECT product."insurerId"
    INTO owner_insurer_id
  FROM public.insurer_product_versions AS version
  INNER JOIN public.insurer_products AS product ON product.id = version."productId"
  WHERE version.id = NEW."productVersionId";

  IF owner_insurer_id IS NULL OR owner_insurer_id <> NEW."insurerId" THEN
    RAISE EXCEPTION 'quote_request_product_versions insurer must own product version'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER quote_request_selection_insurer_guard
BEFORE INSERT OR UPDATE OF "productVersionId", "insurerId"
ON public.quote_request_product_versions
FOR EACH ROW EXECUTE FUNCTION public.enforce_quote_request_selection_insurer();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.enforce_insurer_quote_selected_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  request_model public."QuoteRequestModel";
BEGIN
  SELECT "model"
    INTO request_model
  FROM public.quote_requests
  WHERE id = NEW."quoteRequestId";

  IF request_model = 'PRODUCT_SELECTION' THEN
    IF NEW."productVersionId" IS NULL OR NOT EXISTS (
      SELECT 1
      FROM public.quote_request_product_versions AS selection
      WHERE selection."quoteRequestId" = NEW."quoteRequestId"
        AND selection."productVersionId" = NEW."productVersionId"
        AND selection."insurerId" = NEW."insurerId"
    ) THEN
      RAISE EXCEPTION 'product-selection quote must reference its selected version and insurer'
        USING ERRCODE = '23514';
    END IF;
  ELSIF request_model = 'LEGACY' AND NEW."productVersionId" IS NOT NULL THEN
    RAISE EXCEPTION 'legacy quote cannot reference a product version'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER insurer_quote_selected_version_guard
BEFORE INSERT OR UPDATE OF "quoteRequestId", "insurerId", "productVersionId"
ON public.insurer_quotes
FOR EACH ROW EXECUTE FUNCTION public.enforce_insurer_quote_selected_version();
