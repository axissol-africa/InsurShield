ALTER TYPE "public"."DocumentKind" ADD VALUE 'INSPECTION_REPORT' BEFORE 'WHITE_BOOK';--> statement-breakpoint
ALTER TYPE "public"."InspectionPurpose" ADD VALUE 'AFTER_PAYMENT';--> statement-breakpoint
ALTER TYPE "public"."InspectionPurpose" ADD VALUE 'CLAIM_ASSESSMENT';--> statement-breakpoint
CREATE TABLE "inspection_reports" (
	"inspectionId" text PRIMARY KEY NOT NULL,
	"documentId" uuid NOT NULL,
	"createdAt" timestamp (3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inspections" ADD COLUMN "policyNumber" text;--> statement-breakpoint
ALTER TABLE "inspections" ADD COLUMN "claimNumber" text;--> statement-breakpoint
ALTER TABLE "inspection_reports" ADD CONSTRAINT "inspection_reports_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "public"."inspections"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "inspection_reports" ADD CONSTRAINT "inspection_reports_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "inspection_reports_documentId_key" ON "inspection_reports" USING btree ("documentId");--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_policyNumber_fkey" FOREIGN KEY ("policyNumber") REFERENCES "public"."policies"("policyNumber") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_claimNumber_fkey" FOREIGN KEY ("claimNumber") REFERENCES "public"."claim_notifications"("claimNumber") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "inspections_policy_root_key" ON "inspections" USING btree ("policyNumber") WHERE "inspections"."policyNumber" IS NOT NULL AND "inspections"."claimNumber" IS NULL AND "inspections"."predecessorId" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "inspections_open_claim_key" ON "inspections" USING btree ("claimNumber") WHERE "inspections"."claimNumber" IS NOT NULL AND "inspections"."status" IN ('REQUESTED', 'SCHEDULED', 'INSPECTOR_ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'REPORT_READY');--> statement-breakpoint
CREATE UNIQUE INDEX "inspections_later_successor_key" ON "inspections" USING btree ("predecessorId") WHERE "inspections"."policyNumber" IS NOT NULL AND "inspections"."predecessorId" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_later_links_check" CHECK (
      ("inspections"."purpose"::text IN ('GENERAL', 'UNDERWRITING') AND "inspections"."policyNumber" IS NULL AND "inspections"."claimNumber" IS NULL)
      OR ("inspections"."purpose"::text = 'AFTER_PAYMENT' AND "inspections"."policyNumber" IS NOT NULL AND "inspections"."insurerId" IS NOT NULL
        AND "inspections"."method" IS NOT NULL AND "inspections"."stage" = 'AFTER_PAYMENT' AND "inspections"."stage" IS NOT NULL
        AND "inspections"."claimNumber" IS NULL AND "inspections"."quoteRequestId" IS NULL)
      OR ("inspections"."purpose"::text = 'CLAIM_ASSESSMENT' AND "inspections"."policyNumber" IS NOT NULL AND "inspections"."insurerId" IS NOT NULL
        AND "inspections"."method" IS NOT NULL AND "inspections"."claimNumber" IS NOT NULL AND "inspections"."stage" IS NULL AND "inspections"."quoteRequestId" IS NULL));
--> statement-breakpoint
-- Later inspection invariants begin
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
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.retention_document_owners(document_id uuid) RETURNS SETOF uuid LANGUAGE sql STABLE AS $$
 SELECT "uploadedByCustomerId" FROM documents WHERE id = document_id AND "uploadedByCustomerId" IS NOT NULL
 UNION SELECT "customerId" FROM policies WHERE "quoteDocumentId" = document_id OR "certificateDocumentId" = document_id
 UNION SELECT "customerId" FROM quote_requests WHERE "whiteBookDocumentId" = document_id
 UNION SELECT q."customerId" FROM insurer_quotes r JOIN quote_requests q ON q.id = r."quoteRequestId" WHERE r."documentId" = document_id
 UNION SELECT q."customerId" FROM inspection_shots r JOIN quote_requests q ON q.id = r."quoteRequestId" WHERE r."documentId" = document_id
 UNION SELECT q."customerId" FROM quote_request_product_requirement_documents r JOIN quote_requests q ON q.id = r."quoteRequestId" WHERE r."documentId" = document_id
 UNION SELECT q."customerId" FROM quote_request_draft_documents r JOIN quote_request_drafts q ON q.id = r."quoteRequestDraftId" WHERE r."documentId" = document_id
 UNION SELECT q."customerId" FROM claim_attachments r JOIN claim_notifications q ON q."claimNumber" = r."claimNumber" WHERE r."documentId" = document_id
 UNION SELECT q."customerId" FROM inspection_photos r JOIN inspections q ON q.id = r."inspectionId" WHERE r."documentId" = document_id
 UNION SELECT q."customerId" FROM service_request_updates r JOIN service_requests q ON q.reference = r.reference WHERE document_id = ANY(r."documentIds")
 UNION SELECT p."customerId" FROM reconciliation_items r JOIN payments p ON p.id = r."paymentId" WHERE document_id = ANY(r."evidenceDocumentIds")
 UNION SELECT p."customerId" FROM reconciliation_items r JOIN policies p ON p."policyNumber" = r."policyNumber" WHERE document_id = ANY(r."evidenceDocumentIds")
 UNION SELECT a."customerId" FROM ncd_evidence e JOIN ncd_applications a ON a.id = e."applicationId" WHERE e."documentId" = document_id
 UNION SELECT i."customerId" FROM inspection_reports r JOIN inspections i ON i.id = r."inspectionId" WHERE r."documentId" = document_id
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
     'inspection_photos'::regclass, 'ncd_evidence'::regclass, 'inspection_reports'::regclass)
 LOOP
   EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s WHERE %I = $1)', ref.relation, ref.col) INTO found USING document_id;
   IF found THEN RETURN true; END IF;
 END LOOP;
 RETURN EXISTS (SELECT 1 FROM public.retention_document_owners(document_id) owner WHERE public.retention_customer_held(owner))
   OR EXISTS (SELECT 1 FROM claim_attachments a JOIN claim_notifications c ON c."claimNumber" = a."claimNumber"
     WHERE a."documentId" = document_id AND c.status::text <> 'CLOSED')
   OR EXISTS (SELECT 1 FROM ncd_evidence e JOIN ncd_applications a ON a.id = e."applicationId"
     WHERE e."documentId" = document_id AND a.status IN ('SUBMITTED', 'UNDER_REVIEW', 'VERIFICATION_REQUIRED'))
   OR EXISTS (SELECT 1 FROM inspections i JOIN claim_notifications c ON c."claimNumber" = i."claimNumber"
     WHERE c.status::text <> 'CLOSED' AND (
       EXISTS (SELECT 1 FROM inspection_reports r WHERE r."inspectionId" = i.id AND r."documentId" = document_id)
       OR EXISTS (SELECT 1 FROM inspection_photos p WHERE p."inspectionId" = i.id AND p."documentId" = document_id)))
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
CREATE TRIGGER "retention_documentId" BEFORE INSERT OR UPDATE OF "documentId" ON inspection_reports
FOR EACH ROW EXECUTE FUNCTION public.retention_reference_guard('documentId', 'scalar');
--> statement-breakpoint
CREATE TRIGGER retention_hold BEFORE INSERT OR UPDATE ON inspections
FOR EACH ROW WHEN (NEW."policyNumber" IS NOT NULL) EXECUTE FUNCTION public.retention_hold_guard();
--> statement-breakpoint
CREATE FUNCTION public.inspection_later_photos_reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM inspections WHERE id = OLD."inspectionId" AND "policyNumber" IS NOT NULL)
   OR (TG_OP = 'UPDATE' AND EXISTS (SELECT 1 FROM inspections WHERE id = NEW."inspectionId" AND "policyNumber" IS NOT NULL)) THEN
   RAISE EXCEPTION 'Later inspection photos are append-only' USING ERRCODE = '55000';
 END IF;
 IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER inspection_later_photos_append_only BEFORE UPDATE OR DELETE ON inspection_photos
FOR EACH ROW EXECUTE FUNCTION public.inspection_later_photos_reject_mutation();
--> statement-breakpoint
CREATE FUNCTION public.inspection_later_photo_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD."policyNumber" IS NOT NULL AND EXISTS (SELECT 1 FROM inspection_photos WHERE "inspectionId" = OLD.id)
   AND (TG_OP = 'DELETE' OR NEW.purpose IS DISTINCT FROM OLD.purpose) THEN
   RAISE EXCEPTION 'Later inspection photos retain their inspection history' USING ERRCODE = '55000';
 END IF;
 IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER inspection_later_photo_history BEFORE DELETE OR UPDATE OF purpose ON inspections
FOR EACH ROW EXECUTE FUNCTION public.inspection_later_photo_history_guard();
--> statement-breakpoint
CREATE FUNCTION public.purchased_inspection_shots_reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM policies WHERE "quoteRequestId" = OLD."quoteRequestId")
   OR EXISTS (SELECT 1 FROM payments WHERE "quoteRequestId" = OLD."quoteRequestId" AND status = 'CONFIRMED')
   OR (TG_OP = 'UPDATE' AND (
     EXISTS (SELECT 1 FROM policies WHERE "quoteRequestId" = NEW."quoteRequestId")
     OR EXISTS (SELECT 1 FROM payments WHERE "quoteRequestId" = NEW."quoteRequestId" AND status = 'CONFIRMED'))) THEN
   RAISE EXCEPTION 'Purchased quote inspection shots are append-only' USING ERRCODE = '55000';
 END IF;
 IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER purchased_inspection_shots_append_only BEFORE UPDATE OR DELETE ON inspection_shots
FOR EACH ROW EXECUTE FUNCTION public.purchased_inspection_shots_reject_mutation();
--> statement-breakpoint
-- Later inspection invariants end
INSERT INTO "notification_templates" ("id", "key", "channel", "category", "version", "subject", "body", "mandatory", "activeFrom")
SELECT gen_random_uuid(), 'inspection.required', channel::"NotificationChannel", 'INSPECTION', 1,
       'An inspection is required', 'An inspection is required for {{reference}} ({{purpose}}). Sign in to see what happens next.',
       true, '1970-01-01T00:00:00Z'
FROM (VALUES ('IN_APP'), ('EMAIL')) AS channels(channel)
ON CONFLICT ("key", "channel", "version") DO NOTHING;
--> statement-breakpoint
INSERT INTO "notification_templates" ("id", "key", "channel", "category", "version", "subject", "body", "mandatory", "activeFrom")
SELECT gen_random_uuid(), 'inspection.report_ready', channel::"NotificationChannel", 'INSPECTION', 1,
       'Your inspection report is ready', 'The inspection report for {{reference}} is ready. Sign in to view it.',
       true, '1970-01-01T00:00:00Z'
FROM (VALUES ('IN_APP'), ('EMAIL')) AS channels(channel)
ON CONFLICT ("key", "channel", "version") DO NOTHING;
