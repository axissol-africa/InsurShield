CREATE TYPE "public"."StatementLineStatus" AS ENUM('MATCHED', 'UNMATCHED', 'MISMATCH', 'DUPLICATE');--> statement-breakpoint
CREATE TYPE "public"."StatementLineType" AS ENUM('CHARGE', 'REFUND', 'REVERSAL');--> statement-breakpoint
CREATE TABLE "provider_statement_imports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider" "PaymentProviderName" NOT NULL,
	"fileName" text NOT NULL,
	"checksum" varchar(64) NOT NULL,
	"periodStart" timestamp (3) with time zone NOT NULL,
	"periodEnd" timestamp (3) with time zone NOT NULL,
	"lineCount" integer NOT NULL,
	"newLines" integer NOT NULL,
	"matched" integer NOT NULL,
	"itemsOpened" integer NOT NULL,
	"importedByStaffId" uuid NOT NULL,
	"createdAt" timestamp (3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_statement_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"importId" uuid NOT NULL,
	"provider" "PaymentProviderName" NOT NULL,
	"lineKey" varchar(64) NOT NULL,
	"type" "StatementLineType" NOT NULL,
	"providerPaymentId" varchar(200) NOT NULL,
	"providerRefundId" varchar(200),
	"amountMinor" bigint NOT NULL,
	"currency" varchar(3) NOT NULL,
	"occurredAt" timestamp (3) with time zone NOT NULL,
	"status" "StatementLineStatus" NOT NULL,
	"paymentId" uuid,
	"refundId" uuid
);
--> statement-breakpoint
ALTER TABLE "reconciliation_items" ADD COLUMN "statementLineId" uuid;--> statement-breakpoint
ALTER TABLE "provider_statement_imports" ADD CONSTRAINT "provider_statement_imports_importedByStaffId_fkey" FOREIGN KEY ("importedByStaffId") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "provider_statement_lines" ADD CONSTRAINT "provider_statement_lines_importId_fkey" FOREIGN KEY ("importId") REFERENCES "public"."provider_statement_imports"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "provider_statement_lines" ADD CONSTRAINT "provider_statement_lines_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "provider_statement_lines" ADD CONSTRAINT "provider_statement_lines_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "public"."payment_refunds"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "provider_statement_imports_provider_checksum_key" ON "provider_statement_imports" USING btree ("provider","checksum");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_statement_lines_provider_lineKey_key" ON "provider_statement_lines" USING btree ("provider","lineKey");--> statement-breakpoint
CREATE INDEX "provider_statement_lines_paymentId_idx" ON "provider_statement_lines" USING btree ("paymentId");--> statement-breakpoint
CREATE UNIQUE INDEX "reconciliation_items_kind_statementLineId_key" ON "reconciliation_items" USING btree ("kind","statementLineId") WHERE "reconciliation_items"."statementLineId" IS NOT NULL;