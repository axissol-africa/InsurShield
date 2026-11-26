CREATE TYPE "public"."ServiceRequestStatus" AS ENUM('SUBMITTED', 'IN_REVIEW', 'INFORMATION_REQUIRED', 'APPROVED', 'COMPLETED', 'DECLINED', 'WITHDRAWN');--> statement-breakpoint
CREATE TYPE "public"."ServiceRequestType" AS ENUM('DETAILS_CHANGE', 'DOCUMENT_REPLACEMENT', 'CANCELLATION', 'ASSISTANCE');--> statement-breakpoint
ALTER TYPE "public"."DocumentKind" ADD VALUE 'SERVICE_REQUEST_DOCUMENT';--> statement-breakpoint
CREATE TABLE "service_request_updates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"reference" text NOT NULL,
	"authorKind" varchar(10) NOT NULL,
	"authorId" uuid,
	"message" text NOT NULL,
	"visibleToCustomer" boolean NOT NULL,
	"statusFrom" "ServiceRequestStatus",
	"statusTo" "ServiceRequestStatus",
	"documentIds" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"createdAt" timestamp (3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "service_request_updates_authorKind_check" CHECK ("service_request_updates"."authorKind" IN ('CUSTOMER', 'INSURER', 'SYSTEM')),
	CONSTRAINT "service_request_updates_customer_visible_check" CHECK ("service_request_updates"."authorKind" <> 'CUSTOMER' OR "service_request_updates"."visibleToCustomer")
);
--> statement-breakpoint
CREATE TABLE "service_requests" (
	"reference" text PRIMARY KEY NOT NULL,
	"policyNumber" text NOT NULL,
	"customerId" uuid NOT NULL,
	"insurerId" uuid NOT NULL,
	"type" "ServiceRequestType" NOT NULL,
	"status" "ServiceRequestStatus" DEFAULT 'SUBMITTED' NOT NULL,
	"reason" text NOT NULL,
	"requestedEffectiveDate" date,
	"decision" varchar(10),
	"decisionNote" text,
	"decidedByStaffId" uuid,
	"decidedAt" timestamp (3) with time zone,
	"refundAmountMinor" bigint,
	"effectiveDate" date,
	"completedAt" timestamp (3) with time zone,
	"completedByStaffId" uuid,
	"reconciliationItemId" uuid,
	"createdAt" timestamp (3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "service_requests_decision_check" CHECK ("service_requests"."decision" IS NULL OR "service_requests"."decision" IN ('APPROVED', 'DECLINED')),
	CONSTRAINT "service_requests_decided_check" CHECK (("service_requests"."decision" IS NULL) = ("service_requests"."decidedAt" IS NULL) AND ("service_requests"."decision" IS NULL) = ("service_requests"."decidedByStaffId" IS NULL)),
	CONSTRAINT "service_requests_status_decision_check" CHECK (("service_requests"."status" NOT IN ('APPROVED', 'COMPLETED') OR "service_requests"."decision" = 'APPROVED') AND ("service_requests"."decision" IS DISTINCT FROM 'APPROVED' OR "service_requests"."status" IN ('APPROVED', 'COMPLETED', 'WITHDRAWN')) AND ("service_requests"."status" = 'DECLINED') = ("service_requests"."decision" IS NOT DISTINCT FROM 'DECLINED')),
	CONSTRAINT "service_requests_completed_check" CHECK (("service_requests"."status" = 'COMPLETED') = ("service_requests"."completedAt" IS NOT NULL)),
	CONSTRAINT "service_requests_cancellation_check" CHECK (("service_requests"."type" = 'CANCELLATION') = ("service_requests"."requestedEffectiveDate" IS NOT NULL)
        AND ("service_requests"."type" = 'CANCELLATION' OR ("service_requests"."refundAmountMinor" IS NULL AND "service_requests"."effectiveDate" IS NULL))
        AND ("service_requests"."type" <> 'CANCELLATION' OR "service_requests"."decision" IS DISTINCT FROM 'APPROVED' OR ("service_requests"."refundAmountMinor" IS NOT NULL AND "service_requests"."effectiveDate" IS NOT NULL))),
	CONSTRAINT "service_requests_refund_check" CHECK ("service_requests"."refundAmountMinor" IS NULL OR "service_requests"."refundAmountMinor" >= 0 AND "service_requests"."refundAmountMinor" <= 99999999999999)
);
--> statement-breakpoint
ALTER TABLE "service_request_updates" ADD CONSTRAINT "service_request_updates_reference_fkey" FOREIGN KEY ("reference") REFERENCES "public"."service_requests"("reference") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_policyNumber_fkey" FOREIGN KEY ("policyNumber") REFERENCES "public"."policies"("policyNumber") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_insurerId_fkey" FOREIGN KEY ("insurerId") REFERENCES "public"."insurers"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_decidedByStaffId_fkey" FOREIGN KEY ("decidedByStaffId") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_completedByStaffId_fkey" FOREIGN KEY ("completedByStaffId") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_reconciliationItemId_fkey" FOREIGN KEY ("reconciliationItemId") REFERENCES "public"."reconciliation_items"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "service_request_updates_reference_createdAt_idx" ON "service_request_updates" USING btree ("reference","createdAt");--> statement-breakpoint
CREATE INDEX "service_requests_customerId_createdAt_idx" ON "service_requests" USING btree ("customerId","createdAt");--> statement-breakpoint
CREATE INDEX "service_requests_insurerId_status_createdAt_idx" ON "service_requests" USING btree ("insurerId","status","createdAt");--> statement-breakpoint
CREATE INDEX "service_requests_policyNumber_idx" ON "service_requests" USING btree ("policyNumber");--> statement-breakpoint
CREATE UNIQUE INDEX "service_requests_policyNumber_open_cancellation_key" ON "service_requests" USING btree ("policyNumber") WHERE "service_requests"."type" = 'CANCELLATION' AND "service_requests"."status" IN ('SUBMITTED', 'IN_REVIEW', 'INFORMATION_REQUIRED', 'APPROVED');--> statement-breakpoint
INSERT INTO "notification_templates" ("id", "key", "channel", "category", "version", "subject", "body", "mandatory", "activeFrom")
VALUES
  (gen_random_uuid(), 'service_request.submitted', 'IN_APP', 'POLICY', 1,
   'We sent your request to {{insurer}}',
   'Your request {{reference}} about policy {{policyNumber}} is with {{insurer}}. We will tell you when they reply.', true, '1970-01-01T00:00:00Z'),
  (gen_random_uuid(), 'service_request.submitted', 'EMAIL', 'POLICY', 1,
   'Your request {{reference}} is with {{insurer}}',
   'Your request {{reference}} about policy {{policyNumber}} is with {{insurer}}. We will email you when they reply. You can follow it in your InsurShield account.', true, '1970-01-01T00:00:00Z'),
  (gen_random_uuid(), 'service_request.information_required', 'IN_APP', 'POLICY', 1,
   '{{insurer}} needs more from you',
   '{{insurer}} asks about your request {{reference}}: {{message}} Reply from your account so they can carry on.', true, '1970-01-01T00:00:00Z'),
  (gen_random_uuid(), 'service_request.information_required', 'EMAIL', 'POLICY', 1,
   '{{insurer}} needs more information for {{reference}}',
   '{{insurer}} asks about your request {{reference}} on policy {{policyNumber}}: {{message}} Sign in to InsurShield to reply so they can carry on.', true, '1970-01-01T00:00:00Z'),
  (gen_random_uuid(), 'service_request.update', 'IN_APP', 'POLICY', 1,
   'An update on your request {{reference}}',
   '{{insurer}}: {{message}}', true, '1970-01-01T00:00:00Z'),
  (gen_random_uuid(), 'service_request.update', 'EMAIL', 'POLICY', 1,
   'An update on your request {{reference}}',
   '{{insurer}} wrote about your request {{reference}} on policy {{policyNumber}}: {{message}}', true, '1970-01-01T00:00:00Z'),
  (gen_random_uuid(), 'service_request.approved', 'IN_APP', 'POLICY', 1,
   '{{insurer}} approved your request',
   '{{insurer}} approved your request {{reference}}. {{message}}', true, '1970-01-01T00:00:00Z'),
  (gen_random_uuid(), 'service_request.approved', 'EMAIL', 'POLICY', 1,
   '{{insurer}} approved your request {{reference}}',
   '{{insurer}} approved your request {{reference}} on policy {{policyNumber}}. {{message}}', true, '1970-01-01T00:00:00Z'),
  (gen_random_uuid(), 'service_request.declined', 'IN_APP', 'POLICY', 1,
   '{{insurer}} declined your request',
   '{{insurer}} declined your request {{reference}}: {{message}}', true, '1970-01-01T00:00:00Z'),
  (gen_random_uuid(), 'service_request.declined', 'EMAIL', 'POLICY', 1,
   '{{insurer}} declined your request {{reference}}',
   '{{insurer}} declined your request {{reference}} on policy {{policyNumber}}: {{message}} If you want to talk it through, contact InsurShield support and quote {{reference}}.', true, '1970-01-01T00:00:00Z'),
  (gen_random_uuid(), 'service_request.completed', 'IN_APP', 'POLICY', 1,
   'Your request {{reference}} is done',
   '{{insurer}} has completed your request {{reference}}. {{message}}', true, '1970-01-01T00:00:00Z'),
  (gen_random_uuid(), 'service_request.completed', 'EMAIL', 'POLICY', 1,
   'Your request {{reference}} is done',
   '{{insurer}} has completed your request {{reference}} on policy {{policyNumber}}. {{message}}', true, '1970-01-01T00:00:00Z');
--> statement-breakpoint
-- What was said on a service request is never rewritten
CREATE OR REPLACE FUNCTION "service_request_updates_reject_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'service_request_updates is append-only' USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "service_request_updates_append_only"
BEFORE UPDATE OR DELETE ON "service_request_updates"
FOR EACH ROW EXECUTE FUNCTION "service_request_updates_reject_mutation"();
