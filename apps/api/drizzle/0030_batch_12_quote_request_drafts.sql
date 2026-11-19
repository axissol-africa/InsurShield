CREATE TABLE "quote_request_draft_documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"quoteRequestDraftId" uuid NOT NULL,
	"slot" varchar(80) NOT NULL,
	"kind" "DocumentKind" NOT NULL,
	"documentId" uuid NOT NULL,
	"createdAt" timestamp (3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quote_request_drafts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"customerId" uuid NOT NULL,
	"commonAnswers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"selectedProductVersionIds" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"configurableAnswers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"expiresAt" timestamp (3) with time zone NOT NULL,
	"createdAt" timestamp (3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "quote_request_drafts_selected_products_limit_check" CHECK (cardinality("quote_request_drafts"."selectedProductVersionIds") <= 5)
);
--> statement-breakpoint
ALTER TABLE "quote_request_draft_documents" ADD CONSTRAINT "quote_request_draft_documents_quoteRequestDraftId_fkey" FOREIGN KEY ("quoteRequestDraftId") REFERENCES "public"."quote_request_drafts"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "quote_request_draft_documents" ADD CONSTRAINT "quote_request_draft_documents_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "quote_request_drafts" ADD CONSTRAINT "quote_request_drafts_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "quote_request_draft_documents_draft_slot_key" ON "quote_request_draft_documents" USING btree ("quoteRequestDraftId","slot");--> statement-breakpoint
CREATE UNIQUE INDEX "quote_request_draft_documents_draft_document_key" ON "quote_request_draft_documents" USING btree ("quoteRequestDraftId","documentId");--> statement-breakpoint
CREATE INDEX "quote_request_draft_documents_documentId_idx" ON "quote_request_draft_documents" USING btree ("documentId");--> statement-breakpoint
CREATE INDEX "quote_request_drafts_customerId_updatedAt_idx" ON "quote_request_drafts" USING btree ("customerId","updatedAt");--> statement-breakpoint
CREATE INDEX "quote_request_drafts_expiresAt_idx" ON "quote_request_drafts" USING btree ("expiresAt");