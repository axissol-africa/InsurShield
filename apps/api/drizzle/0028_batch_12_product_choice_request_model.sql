CREATE TABLE "quote_request_product_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"quoteRequestId" text NOT NULL,
	"productVersionId" uuid NOT NULL,
	"selectedAt" timestamp (3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
DROP INDEX "insurer_quotes_quoteRequestId_insurerId_key";--> statement-breakpoint
DROP INDEX "insurer_quotes_quoteRequestId_insurerReference_key";--> statement-breakpoint
ALTER TABLE "insurer_quotes" ADD COLUMN "productVersionId" uuid;--> statement-breakpoint
ALTER TABLE "quote_request_product_versions" ADD CONSTRAINT "quote_request_product_versions_quoteRequestId_fkey" FOREIGN KEY ("quoteRequestId") REFERENCES "public"."quote_requests"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "quote_request_product_versions" ADD CONSTRAINT "quote_request_product_versions_productVersionId_fkey" FOREIGN KEY ("productVersionId") REFERENCES "public"."insurer_product_versions"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "quote_request_product_versions_request_version_key" ON "quote_request_product_versions" USING btree ("quoteRequestId","productVersionId");--> statement-breakpoint
CREATE INDEX "quote_request_product_versions_productVersionId_idx" ON "quote_request_product_versions" USING btree ("productVersionId");--> statement-breakpoint
ALTER TABLE "insurer_quotes" ADD CONSTRAINT "insurer_quotes_productVersionId_fkey" FOREIGN KEY ("productVersionId") REFERENCES "public"."insurer_product_versions"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "insurer_quotes_productVersionId_idx" ON "insurer_quotes" USING btree ("productVersionId");--> statement-breakpoint
CREATE UNIQUE INDEX "insurer_quotes_legacy_request_insurer_key" ON "insurer_quotes" USING btree ("quoteRequestId","insurerId") WHERE "insurer_quotes"."productVersionId" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "insurer_quotes_request_product_version_key" ON "insurer_quotes" USING btree ("quoteRequestId","productVersionId") WHERE "insurer_quotes"."productVersionId" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "insurer_quotes_quoteRequestId_insurerReference_key" ON "insurer_quotes" USING btree ("quoteRequestId","insurerReference") WHERE "insurer_quotes"."productVersionId" IS NULL;