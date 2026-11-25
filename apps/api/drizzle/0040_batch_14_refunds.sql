CREATE TYPE "public"."RefundReason" AS ENUM('ISSUANCE_FAILED', 'INSURER_UNAVAILABLE', 'DUPLICATE_PAYMENT', 'AMOUNT_MISMATCH', 'CUSTOMER_REQUEST', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."RefundStatus" AS ENUM('PROPOSED', 'APPROVED', 'SUBMITTED', 'COMPLETED', 'REJECTED', 'EXPIRED', 'FAILED');--> statement-breakpoint
ALTER TYPE "public"."ApprovalAction" ADD VALUE 'PAYMENT_REFUND';--> statement-breakpoint
CREATE TABLE "payment_refunds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"paymentId" uuid NOT NULL,
	"amountMinor" bigint NOT NULL,
	"reasonCode" "RefundReason" NOT NULL,
	"reason" text NOT NULL,
	"status" "RefundStatus" DEFAULT 'PROPOSED' NOT NULL,
	"approvalRequestId" uuid,
	"reconciliationItemId" uuid,
	"provider" "PaymentProviderName" NOT NULL,
	"providerRefundId" varchar(200),
	"proposedByStaffId" uuid NOT NULL,
	"approvedAt" timestamp (3) with time zone,
	"submittedAt" timestamp (3) with time zone,
	"completedAt" timestamp (3) with time zone,
	"failureReason" text,
	"createdAt" timestamp (3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "payment_refunds_amount_check" CHECK ("payment_refunds"."amountMinor" > 0)
);
--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_reconciliationItemId_fkey" FOREIGN KEY ("reconciliationItemId") REFERENCES "public"."reconciliation_items"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_proposedByStaffId_fkey" FOREIGN KEY ("proposedByStaffId") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_refunds_paymentId_open_key" ON "payment_refunds" USING btree ("paymentId") WHERE "payment_refunds"."status" IN ('PROPOSED', 'APPROVED', 'SUBMITTED');--> statement-breakpoint
CREATE UNIQUE INDEX "payment_refunds_provider_providerRefundId_key" ON "payment_refunds" USING btree ("provider","providerRefundId");--> statement-breakpoint
CREATE INDEX "payment_refunds_status_idx" ON "payment_refunds" USING btree ("status","updatedAt");--> statement-breakpoint
INSERT INTO "notification_templates" ("id", "key", "channel", "category", "version", "subject", "body", "mandatory", "activeFrom")
VALUES
  (gen_random_uuid(), 'payment.refunded', 'IN_APP', 'PAYMENT', 1,
   'Refund sent',
   'We have refunded {{amount}} for your payment {{transactionId}}. It can take a few days to reach you, depending on your provider.', true, '1970-01-01T00:00:00Z'),
  (gen_random_uuid(), 'payment.refunded', 'EMAIL', 'PAYMENT', 1,
   'Your refund has been sent',
   'We have refunded {{amount}} for your payment {{transactionId}}. It can take a few days to reach you, depending on your mobile money provider or bank.', true, '1970-01-01T00:00:00Z');
