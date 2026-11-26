CREATE TABLE "ncd_evidence" (
	"applicationId" uuid NOT NULL,
	"documentId" uuid NOT NULL,
	"verificationRevision" integer NOT NULL,
	"createdAt" timestamp (3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ncd_applications" ADD COLUMN "sourcePolicyNumber" text;--> statement-breakpoint
ALTER TABLE "ncd_applications" ADD COLUMN "sourceVehicleId" uuid;--> statement-breakpoint
ALTER TABLE "ncd_applications" ADD COLUMN "declarationAcceptedAt" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "ncd_applications" ADD COLUMN "declarationVersion" text;--> statement-breakpoint
ALTER TABLE "ncd_applications" ADD COLUMN "decisionNote" text;--> statement-breakpoint
ALTER TABLE "ncd_applications" ADD COLUMN "verificationRevision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ncd_codes" ADD COLUMN "revokedAt" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "ncd_codes" ADD COLUMN "issuedRuleVersion" integer;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "reservedNcdCode" text;--> statement-breakpoint
ALTER TABLE "ncd_evidence" ADD CONSTRAINT "ncd_evidence_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "public"."ncd_applications"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ncd_evidence" ADD CONSTRAINT "ncd_evidence_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "ncd_evidence_documentId_key" ON "ncd_evidence" USING btree ("documentId");--> statement-breakpoint
CREATE INDEX "ncd_evidence_application_revision_created_idx" ON "ncd_evidence" USING btree ("applicationId","verificationRevision","createdAt","documentId");--> statement-breakpoint
ALTER TABLE "ncd_applications" ADD CONSTRAINT "ncd_applications_sourcePolicyNumber_fkey" FOREIGN KEY ("sourcePolicyNumber") REFERENCES "public"."policies"("policyNumber") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ncd_applications" ADD CONSTRAINT "ncd_applications_sourceVehicleId_fkey" FOREIGN KEY ("sourceVehicleId") REFERENCES "public"."vehicles"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_reservedNcdCode_fkey" FOREIGN KEY ("reservedNcdCode") REFERENCES "public"."ncd_codes"("code") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_open_ncd_code_idx" ON "payments" USING btree ("reservedNcdCode") WHERE "payments"."status" IN ('INITIATED', 'PENDING');
--> statement-breakpoint
-- NCD retention invariants begin
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
     'inspection_photos'::regclass, 'ncd_evidence'::regclass)
 LOOP
   EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s WHERE %I = $1)', ref.relation, ref.col) INTO found USING document_id;
   IF found THEN RETURN true; END IF;
 END LOOP;
 RETURN EXISTS (SELECT 1 FROM public.retention_document_owners(document_id) owner WHERE public.retention_customer_held(owner))
   OR EXISTS (SELECT 1 FROM claim_attachments a JOIN claim_notifications c ON c."claimNumber" = a."claimNumber"
     WHERE a."documentId" = document_id AND c.status::text <> 'CLOSED')
   OR EXISTS (SELECT 1 FROM ncd_evidence e JOIN ncd_applications a ON a.id = e."applicationId"
     WHERE e."documentId" = document_id AND a.status IN ('SUBMITTED', 'UNDER_REVIEW', 'VERIFICATION_REQUIRED'))
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
CREATE TRIGGER "retention_documentId" BEFORE INSERT OR UPDATE OF "documentId" ON ncd_evidence
FOR EACH ROW EXECUTE FUNCTION public.retention_reference_guard('documentId', 'scalar');
--> statement-breakpoint
CREATE TRIGGER retention_hold BEFORE INSERT OR UPDATE ON ncd_applications
FOR EACH ROW EXECUTE FUNCTION public.retention_hold_guard();
--> statement-breakpoint
-- NCD retention invariants end
INSERT INTO "notification_templates" ("id", "key", "channel", "category", "version", "subject", "body", "mandatory", "activeFrom")
SELECT gen_random_uuid(), template.key, channel::"NotificationChannel", 'NCD', 1, template.subject, template.body,
       true, '1970-01-01T00:00:00Z'
FROM (VALUES
  ('ncd.submitted', 'We received your NCD application', 'Your NCD application is with {{insurer}}. Sign in to follow its progress.'),
  ('ncd.review_started', 'Your NCD application is under review', '{{insurer}} is reviewing your NCD application. Sign in to follow its progress.'),
  ('ncd.verification_requested', 'Your insurer needs NCD verification', '{{insurer}} needs more information to verify your NCD application. Sign in to see what to upload.'),
  ('ncd.evidence_submitted', 'We received your NCD evidence', 'Your evidence is with {{insurer}} for review. Sign in to follow your NCD application.')
) AS template(key, subject, body)
CROSS JOIN (VALUES ('IN_APP'), ('EMAIL')) AS channels(channel)
ON CONFLICT ("key", "channel", "version") DO NOTHING;

--> statement-breakpoint
ALTER TABLE "insurer_quotes" ADD COLUMN "ncdPercentage" integer;--> statement-breakpoint
ALTER TABLE "insurer_quotes" ADD CONSTRAINT "insurer_quotes_ncd_percentage_check" CHECK ("insurer_quotes"."ncdPercentage" IS NULL OR "insurer_quotes"."ncdPercentage" BETWEEN 0 AND 100);
