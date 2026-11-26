CREATE TABLE "customer_content_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" varchar(100) NOT NULL,
	"type" varchar(10) NOT NULL,
	"version" integer NOT NULL,
	"title" varchar(200) NOT NULL,
	"body" text NOT NULL,
	"audience" varchar(20) DEFAULT 'CUSTOMER' NOT NULL,
	"channel" varchar(20) DEFAULT 'SUPPORT' NOT NULL,
	"status" varchar(20) DEFAULT 'DRAFT' NOT NULL,
	"effective_from" date NOT NULL,
	"expires_on" date,
	"owner_staff_id" uuid NOT NULL,
	"approved_by_staff_id" uuid,
	"approved_at" timestamp (3) with time zone,
	"withdrawn_by_staff_id" uuid,
	"withdrawn_at" timestamp (3) with time zone,
	"withdrawal_reason" text,
	"created_at" timestamp (3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "customer_content_type_check" CHECK ("customer_content_versions"."type" IN ('FAQ', 'NOTICE', 'LEGAL')),
	CONSTRAINT "customer_content_status_check" CHECK ("customer_content_versions"."status" IN ('DRAFT', 'APPROVED', 'WITHDRAWN')),
	CONSTRAINT "customer_content_target_check" CHECK ("customer_content_versions"."audience" = 'CUSTOMER' AND "customer_content_versions"."channel" = 'SUPPORT'),
	CONSTRAINT "customer_content_version_check" CHECK ("customer_content_versions"."version" > 0),
	CONSTRAINT "customer_content_dates_check" CHECK ("customer_content_versions"."expires_on" IS NULL OR "customer_content_versions"."expires_on" >= "customer_content_versions"."effective_from"),
	CONSTRAINT "customer_content_approval_check" CHECK (("customer_content_versions"."approved_at" IS NULL AND "customer_content_versions"."approved_by_staff_id" IS NULL AND "customer_content_versions"."status" <> 'APPROVED') OR ("customer_content_versions"."approved_at" IS NOT NULL AND "customer_content_versions"."approved_by_staff_id" IS NOT NULL AND "customer_content_versions"."approved_by_staff_id" <> "customer_content_versions"."owner_staff_id" AND "customer_content_versions"."status" <> 'DRAFT')),
	CONSTRAINT "customer_content_withdrawal_check" CHECK (("customer_content_versions"."status" = 'WITHDRAWN' AND "customer_content_versions"."withdrawn_at" IS NOT NULL AND "customer_content_versions"."withdrawn_by_staff_id" IS NOT NULL AND "customer_content_versions"."withdrawal_reason" IS NOT NULL AND length(trim("customer_content_versions"."withdrawal_reason")) > 0) OR ("customer_content_versions"."status" <> 'WITHDRAWN' AND "customer_content_versions"."withdrawn_at" IS NULL AND "customer_content_versions"."withdrawn_by_staff_id" IS NULL AND "customer_content_versions"."withdrawal_reason" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "privacy_request_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"requestId" uuid NOT NULL,
	"version" integer NOT NULL,
	"action" text NOT NULL,
	"actorCustomerId" uuid,
	"actorStaffId" uuid,
	"decisionReference" text,
	"rationale" text,
	"evidenceReference" text,
	"affectedRecords" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"createdAt" timestamp (3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "privacy_request_events_actor_check" CHECK (("privacy_request_events"."actorCustomerId" IS NULL) <> ("privacy_request_events"."actorStaffId" IS NULL)),
	CONSTRAINT "privacy_request_events_action_check" CHECK ("privacy_request_events"."action" IN ('SUBMITTED', 'ASSIGNED', 'VERIFIED', 'DECIDED', 'COMPLETED', 'HOLD_APPROVED', 'HOLD_RELEASED')),
	CONSTRAINT "privacy_request_events_bounds_check" CHECK (length("privacy_request_events"."decisionReference") <= 200 AND length("privacy_request_events"."rationale") <= 2000 AND length("privacy_request_events"."evidenceReference") <= 200 AND jsonb_array_length("privacy_request_events"."affectedRecords") <= 50)
);
--> statement-breakpoint
CREATE TABLE "privacy_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"customerId" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'SUBMITTED' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"requestedByStaffId" uuid,
	"ownerStaffId" uuid,
	"identityVerifiedAt" timestamp (3) with time zone,
	"held" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp (3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"completedAt" timestamp (3) with time zone,
	CONSTRAINT "privacy_requests_kind_check" CHECK ("privacy_requests"."kind" IN ('ACCESS', 'CORRECTION', 'ERASURE', 'RESTRICTION', 'RETENTION_REVIEW')),
	CONSTRAINT "privacy_requests_status_check" CHECK ("privacy_requests"."status" IN ('SUBMITTED', 'VERIFIED', 'DECIDED', 'COMPLETED')),
	CONSTRAINT "privacy_requests_version_check" CHECK ("privacy_requests"."version" > 0),
	CONSTRAINT "privacy_requests_completion_check" CHECK (("privacy_requests"."status" = 'COMPLETED') = ("privacy_requests"."completedAt" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "risk_review_flags" (
	"id" uuid PRIMARY KEY NOT NULL,
	"reconciliationItemId" uuid,
	"quoteId" uuid,
	"evidenceReference" text NOT NULL,
	"severity" text NOT NULL,
	"reason" text NOT NULL,
	"nextAction" text NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"workflowEffect" text DEFAULT 'METADATA_ONLY' NOT NULL,
	"ownerStaffId" uuid,
	"referredByStaffId" uuid NOT NULL,
	"openedAt" timestamp (3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp (3) with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"outcome" text,
	"resolutionReason" text,
	"resolvedByStaffId" uuid,
	"resolvedAt" timestamp (3) with time zone,
	CONSTRAINT "risk_review_reference_check" CHECK (num_nonnulls("risk_review_flags"."reconciliationItemId", "risk_review_flags"."quoteId") = 1),
	CONSTRAINT "risk_review_evidence_check" CHECK ("risk_review_flags"."evidenceReference" = CASE WHEN "risk_review_flags"."quoteId" IS NOT NULL THEN 'quote:' || "risk_review_flags"."quoteId"::text ELSE 'reconciliation:' || "risk_review_flags"."reconciliationItemId"::text END),
	CONSTRAINT "risk_review_values_check" CHECK ("risk_review_flags"."severity" IN ('LOW','MEDIUM','HIGH') AND "risk_review_flags"."status" IN ('OPEN','IN_PROGRESS','RESOLVED') AND "risk_review_flags"."workflowEffect" = 'METADATA_ONLY' AND "risk_review_flags"."version" > 0 AND length(btrim("risk_review_flags"."reason")) BETWEEN 10 AND 1000 AND length(btrim("risk_review_flags"."nextAction")) BETWEEN 3 AND 500),
	CONSTRAINT "risk_review_resolution_check" CHECK (("risk_review_flags"."status" = 'RESOLVED' AND "risk_review_flags"."outcome" IN ('NO_ACTION','REFERRED') AND "risk_review_flags"."outcome" IS NOT NULL AND "risk_review_flags"."resolutionReason" IS NOT NULL AND length(btrim("risk_review_flags"."resolutionReason")) BETWEEN 10 AND 1000 AND "risk_review_flags"."resolvedByStaffId" IS NOT NULL AND "risk_review_flags"."resolvedAt" IS NOT NULL) OR ("risk_review_flags"."status" <> 'RESOLVED' AND "risk_review_flags"."outcome" IS NULL AND "risk_review_flags"."resolutionReason" IS NULL AND "risk_review_flags"."resolvedByStaffId" IS NULL AND "risk_review_flags"."resolvedAt" IS NULL)),
	CONSTRAINT "risk_review_owner_check" CHECK ("risk_review_flags"."status" = 'RESOLVED' OR ("risk_review_flags"."status" = 'OPEN' AND "risk_review_flags"."ownerStaffId" IS NULL) OR ("risk_review_flags"."status" = 'IN_PROGRESS' AND "risk_review_flags"."ownerStaffId" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "notification_templates" ADD COLUMN "owner" text DEFAULT 'PLATFORM' NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_templates" ADD COLUMN "reviewStatus" text DEFAULT 'APPROVED' NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_templates" ADD COLUMN "effectiveFrom" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "notification_templates" ADD COLUMN "expiresAt" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "notification_templates" ADD COLUMN "createdBy" text;--> statement-breakpoint
ALTER TABLE "notification_templates" ADD COLUMN "createdByRole" text;--> statement-breakpoint
ALTER TABLE "notification_templates" ADD COLUMN "approvedBy" text;--> statement-breakpoint
ALTER TABLE "notification_templates" ADD COLUMN "approvedByRole" text;--> statement-breakpoint
ALTER TABLE "notification_templates" ADD COLUMN "approvedAt" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "notification_templates" ADD COLUMN "withdrawnBy" text;--> statement-breakpoint
ALTER TABLE "notification_templates" ADD COLUMN "withdrawnAt" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "customer_content_versions" ADD CONSTRAINT "customer_content_versions_owner_staff_id_staff_users_id_fk" FOREIGN KEY ("owner_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_content_versions" ADD CONSTRAINT "customer_content_versions_approved_by_staff_id_staff_users_id_fk" FOREIGN KEY ("approved_by_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_content_versions" ADD CONSTRAINT "customer_content_versions_withdrawn_by_staff_id_staff_users_id_fk" FOREIGN KEY ("withdrawn_by_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_request_events" ADD CONSTRAINT "privacy_request_events_requestId_privacy_requests_id_fk" FOREIGN KEY ("requestId") REFERENCES "public"."privacy_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_request_events" ADD CONSTRAINT "privacy_request_events_actorCustomerId_customers_id_fk" FOREIGN KEY ("actorCustomerId") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_request_events" ADD CONSTRAINT "privacy_request_events_actorStaffId_staff_users_id_fk" FOREIGN KEY ("actorStaffId") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_customerId_customers_id_fk" FOREIGN KEY ("customerId") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_requestedByStaffId_staff_users_id_fk" FOREIGN KEY ("requestedByStaffId") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_ownerStaffId_staff_users_id_fk" FOREIGN KEY ("ownerStaffId") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_review_flags" ADD CONSTRAINT "risk_review_reconciliation_fkey" FOREIGN KEY ("reconciliationItemId") REFERENCES "public"."reconciliation_items"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "risk_review_flags" ADD CONSTRAINT "risk_review_quote_fkey" FOREIGN KEY ("quoteId") REFERENCES "public"."insurer_quotes"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "risk_review_flags" ADD CONSTRAINT "risk_review_owner_fkey" FOREIGN KEY ("ownerStaffId") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "risk_review_flags" ADD CONSTRAINT "risk_review_referrer_fkey" FOREIGN KEY ("referredByStaffId") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "risk_review_flags" ADD CONSTRAINT "risk_review_resolver_fkey" FOREIGN KEY ("resolvedByStaffId") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_content_slug_version_unique" ON "customer_content_versions" USING btree ("slug","version");--> statement-breakpoint
CREATE UNIQUE INDEX "privacy_request_events_version_key" ON "privacy_request_events" USING btree ("requestId","version");--> statement-breakpoint
CREATE INDEX "privacy_requests_customer_idx" ON "privacy_requests" USING btree ("customerId","createdAt");--> statement-breakpoint
CREATE INDEX "privacy_requests_queue_idx" ON "privacy_requests" USING btree ("status","createdAt");--> statement-breakpoint
CREATE INDEX "privacy_requests_active_hold_idx" ON "privacy_requests" USING btree ("customerId") WHERE "privacy_requests"."held";--> statement-breakpoint
CREATE UNIQUE INDEX "risk_review_reconciliation_open_key" ON "risk_review_flags" USING btree ("reconciliationItemId") WHERE "risk_review_flags"."status" <> 'RESOLVED';--> statement-breakpoint
CREATE UNIQUE INDEX "risk_review_quote_open_key" ON "risk_review_flags" USING btree ("quoteId") WHERE "risk_review_flags"."status" <> 'RESOLVED';--> statement-breakpoint
CREATE INDEX "risk_review_status_id_idx" ON "risk_review_flags" USING btree ("status","id");--> statement-breakpoint
ALTER TABLE "notification_templates" ADD CONSTRAINT "notification_templates_review_status_check" CHECK ("notification_templates"."reviewStatus" IN ('DRAFT', 'APPROVED', 'WITHDRAWN'));--> statement-breakpoint
ALTER TABLE "notification_templates" ADD CONSTRAINT "notification_templates_expiry_check" CHECK ("notification_templates"."expiresAt" IS NULL OR "notification_templates"."expiresAt" > coalesce("notification_templates"."effectiveFrom", "notification_templates"."activeFrom"));
--> statement-breakpoint
-- Governance invariants begin
CREATE OR REPLACE FUNCTION public.retention_customer_held(customer_id uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
 SELECT EXISTS (SELECT 1 FROM policies WHERE "customerId" = customer_id AND
   (status IN ('AWAITING_INSURER_CERTIFICATE') OR (status = 'ACTIVE' AND ("policyEndDate" IS NULL OR ("policyEndDate" AT TIME ZONE 'Africa/Lusaka')::date >= (CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Lusaka')::date))))
 OR EXISTS (SELECT 1 FROM claim_notifications c LEFT JOIN policies p ON p."policyNumber" = c."policyNumber"
   WHERE coalesce(c."customerId", p."customerId") = customer_id AND c.status::text <> 'CLOSED')
 OR EXISTS (SELECT 1 FROM service_requests WHERE "customerId" = customer_id AND status NOT IN ('COMPLETED', 'DECLINED', 'WITHDRAWN'))
 OR EXISTS (SELECT 1 FROM payments WHERE "customerId" = customer_id AND
   (status IN ('INITIATED', 'PENDING') OR (status = 'CONFIRMED' AND "settlementId" IS NULL)))
 OR EXISTS (SELECT 1 FROM reconciliation_items r LEFT JOIN payments p ON p.id = r."paymentId"
   LEFT JOIN policies pol ON pol."policyNumber" = r."policyNumber"
   WHERE r.status <> 'RESOLVED' AND (p."customerId" = customer_id OR pol."customerId" = customer_id))
 OR EXISTS (SELECT 1 FROM payment_refunds r JOIN payments p ON p.id = r."paymentId"
   WHERE p."customerId" = customer_id AND r.status NOT IN ('COMPLETED', 'FAILED', 'REJECTED', 'EXPIRED'))
 OR EXISTS (SELECT 1 FROM ncd_applications WHERE "customerId" = customer_id
   AND status IN ('SUBMITTED', 'UNDER_REVIEW', 'VERIFICATION_REQUIRED'))
 OR EXISTS (SELECT 1 FROM inspections WHERE "customerId" = customer_id AND "policyNumber" IS NOT NULL
   AND status IN ('REQUESTED', 'SCHEDULED', 'INSPECTOR_ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'REPORT_READY'))
 OR EXISTS (SELECT 1 FROM privacy_requests WHERE "customerId" = customer_id AND held)
$$;
--> statement-breakpoint
CREATE FUNCTION public.privacy_hold_fence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."customerId" IS DISTINCT FROM OLD."customerId" THEN
      RAISE EXCEPTION 'Privacy request customer cannot change' USING ERRCODE = '23514';
    END IF;
    IF OLD.held THEN RETURN NEW; END IF;
  END IF;
  IF NOT NEW.held THEN RETURN NEW; END IF;

  -- The retention worker uses the same customer advisory lock before claiming deletion.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW."customerId"::text, 16));
  IF EXISTS (SELECT 1 FROM customers c WHERE c.id = NEW."customerId" AND c."anonymisedAt" IS NOT NULL)
    OR EXISTS (
      SELECT 1 FROM documents d
      WHERE d."deletionStartedAt" IS NOT NULL
        AND NEW."customerId" IN (SELECT public.retention_document_owners(d.id))
    )
  THEN
    RAISE EXCEPTION 'Retention has already started for this customer' USING ERRCODE = '40001';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER privacy_request_hold_fence BEFORE INSERT OR UPDATE OF "customerId", held
ON public.privacy_requests FOR EACH ROW EXECUTE FUNCTION public.privacy_hold_fence();
--> statement-breakpoint
CREATE FUNCTION public.privacy_request_events_reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Privacy request events are append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER privacy_request_events_append_only BEFORE UPDATE OR DELETE
ON public.privacy_request_events FOR EACH ROW EXECUTE FUNCTION public.privacy_request_events_reject_mutation();
-- Governance invariants end
