ALTER TYPE "public"."ClaimStatus" ADD VALUE 'UNDER_REVIEW';--> statement-breakpoint
ALTER TYPE "public"."ClaimStatus" ADD VALUE 'EVIDENCE_REQUIRED';--> statement-breakpoint
ALTER TYPE "public"."ClaimStatus" ADD VALUE 'APPROVED';--> statement-breakpoint
ALTER TYPE "public"."ClaimStatus" ADD VALUE 'DECLINED';--> statement-breakpoint
ALTER TYPE "public"."ClaimStatus" ADD VALUE 'CLOSED';--> statement-breakpoint
ALTER TYPE "public"."RuleSettingKey" ADD VALUE 'CLAIM_REPORTING';--> statement-breakpoint
CREATE TABLE "claim_updates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"claimNumber" text NOT NULL,
	"status" "ClaimStatus" NOT NULL,
	"actorKind" text NOT NULL,
	"message" text NOT NULL,
	"evidenceRequest" text,
	"createdAt" timestamp (3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "claim_updates_claim_number_id_key" UNIQUE("claimNumber","id"),
	CONSTRAINT "claim_updates_actor_kind_check" CHECK ("claim_updates"."actorKind" IN ('CUSTOMER', 'INSURER'))
);
--> statement-breakpoint
ALTER TABLE "claim_attachments" ADD COLUMN "claimUpdateId" uuid;--> statement-breakpoint
ALTER TABLE "claim_notifications" ADD COLUMN "responseDueOn" date;--> statement-breakpoint
ALTER TABLE "claim_notifications" ADD COLUMN "lateSubmission" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "claim_notifications" ADD COLUMN "intakeRuleVersion" integer;--> statement-breakpoint
ALTER TABLE "claim_updates" ADD CONSTRAINT "claim_updates_claimNumber_fkey" FOREIGN KEY ("claimNumber") REFERENCES "public"."claim_notifications"("claimNumber") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "claim_updates_claim_number_created_at_idx" ON "claim_updates" USING btree ("claimNumber","createdAt");--> statement-breakpoint
ALTER TABLE "claim_attachments" ADD CONSTRAINT "claim_attachments_claim_update_fkey" FOREIGN KEY ("claimNumber","claimUpdateId") REFERENCES "public"."claim_updates"("claimNumber","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "claim_attachments_claim_number_idx" ON "claim_attachments" USING btree ("claimNumber");
--> statement-breakpoint
-- Claim evidence remains held until the insurer closes the case.
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
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.retention_document_held(document_id uuid) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE ref record; found boolean;
BEGIN
 -- New FK types require a deliberate retention classification before deletion.
 FOR ref IN SELECT c.conrelid::regclass AS relation, a.attname AS col
   FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
   WHERE c.contype = 'f' AND c.confrelid = 'public.documents'::regclass
   AND c.conrelid NOT IN ('policies'::regclass, 'quote_requests'::regclass, 'insurer_quotes'::regclass,
     'inspection_shots'::regclass, 'quote_request_product_requirement_documents'::regclass,
     'quote_request_draft_documents'::regclass, 'claim_attachments'::regclass,
     'inspection_photos'::regclass)
 LOOP
   EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s WHERE %I = $1)', ref.relation, ref.col) INTO found USING document_id;
   IF found THEN RETURN true; END IF;
 END LOOP;
 RETURN EXISTS (SELECT 1 FROM public.retention_document_owners(document_id) owner WHERE public.retention_customer_held(owner))
   OR EXISTS (SELECT 1 FROM claim_attachments a JOIN claim_notifications c ON c."claimNumber" = a."claimNumber"
     WHERE a."documentId" = document_id AND c.status::text <> 'CLOSED')
   OR EXISTS (SELECT 1 FROM reconciliation_items WHERE document_id = ANY("evidenceDocumentIds") AND status <> 'RESOLVED')
   OR EXISTS (SELECT 1 FROM service_request_updates u JOIN service_requests r ON r.reference = u.reference
      WHERE document_id = ANY(u."documentIds") AND r.status NOT IN ('COMPLETED', 'DECLINED', 'WITHDRAWN'))
   OR EXISTS (SELECT 1 FROM quote_request_draft_documents a JOIN quote_request_drafts d ON d.id = a."quoteRequestDraftId"
      WHERE a."documentId" = document_id AND d."expiresAt" > CURRENT_TIMESTAMP)
   OR EXISTS (SELECT 1 FROM documents d JOIN insurers i ON i."logoUrl" LIKE '%' || d.id::text || '%' OR i."logoUrl" LIKE '%' || d."storageKey" || '%'
      WHERE d.id = document_id AND i."deletedAt" IS NULL)
   OR NOT EXISTS (SELECT 1 FROM public.retention_document_owners(document_id));
END $$;
--> statement-breakpoint
CREATE FUNCTION public.claim_updates_reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'claim_updates is append-only' USING ERRCODE = '55000';
END $$;
--> statement-breakpoint
CREATE TRIGGER claim_updates_append_only BEFORE UPDATE OR DELETE ON public.claim_updates
FOR EACH ROW EXECUTE FUNCTION public.claim_updates_reject_mutation();
--> statement-breakpoint
-- Claim update notification templates keep personal and incident details in the signed-in claim view.
INSERT INTO "notification_templates" ("id", "key", "channel", "category", "version", "subject", "body", "mandatory", "activeFrom")
SELECT gen_random_uuid(), template.key, channel::"NotificationChannel", 'CLAIM', 1, template.subject, template.body,
       true, '1970-01-01T00:00:00Z'
FROM (VALUES
  ('claim.review_started', 'Your claim is under review', 'Your insurer is reviewing claim {{claimNumber}}. Sign in to follow its progress.'),
  ('claim.evidence_requested', 'Your insurer needs more information', 'Sign in to see what to upload for claim {{claimNumber}}.'),
  ('claim.evidence_submitted', 'We have your claim evidence', 'Your evidence for claim {{claimNumber}} is with your insurer for review.'),
  ('claim.approved', 'Your insurer approved your claim', 'Sign in to see the insurer update for claim {{claimNumber}}.'),
  ('claim.declined', 'Your insurer declined your claim', 'Sign in to see the reason for the decision on claim {{claimNumber}}.'),
  ('claim.closed', 'Your insurer closed your claim', 'Sign in to see the final update for claim {{claimNumber}}.')
) AS template(key, subject, body)
CROSS JOIN (VALUES ('IN_APP'), ('EMAIL')) AS channels(channel)
ON CONFLICT ("key", "channel", "version") DO NOTHING;
