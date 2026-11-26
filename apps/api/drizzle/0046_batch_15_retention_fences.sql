ALTER TABLE "documents" ADD COLUMN "deletionStartedAt" timestamp (3) with time zone;--> statement-breakpoint

CREATE FUNCTION public.retention_customer_held(customer_id uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
 SELECT EXISTS (SELECT 1 FROM policies WHERE "customerId" = customer_id AND
   (status IN ('AWAITING_INSURER_CERTIFICATE') OR (status = 'ACTIVE' AND ("policyEndDate" IS NULL OR ("policyEndDate" AT TIME ZONE 'Africa/Lusaka')::date >= (CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Lusaka')::date))))
 OR EXISTS (SELECT 1 FROM claim_notifications c LEFT JOIN policies p ON p."policyNumber" = c."policyNumber"
   WHERE coalesce(c."customerId", p."customerId") = customer_id)
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
CREATE FUNCTION public.retention_document_owners(document_id uuid) RETURNS SETOF uuid LANGUAGE sql STABLE AS $$
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
$$;
--> statement-breakpoint
CREATE FUNCTION public.retention_document_held(document_id uuid) RETURNS boolean LANGUAGE plpgsql AS $$
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
   OR EXISTS (SELECT 1 FROM claim_attachments WHERE "documentId" = document_id)
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
-- Only document-scoped locks; no tenant-wide or global serialization.
CREATE FUNCTION public.retention_reference_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE document_id uuid; ids uuid[];
BEGIN
 IF TG_ARGV[1] = 'array' THEN
   SELECT coalesce(array_agg(value::uuid ORDER BY value), '{}'::uuid[]) INTO ids FROM jsonb_array_elements_text(to_jsonb(NEW)->TG_ARGV[0]);
 ELSE ids := ARRAY[(to_jsonb(NEW)->>TG_ARGV[0])::uuid]; END IF;
 FOREACH document_id IN ARRAY ids LOOP
   IF document_id IS NULL THEN CONTINUE; END IF;
   PERFORM pg_advisory_xact_lock(hashtextextended(document_id::text, 15));
   IF EXISTS (SELECT 1 FROM documents WHERE id = document_id AND ("deletionStartedAt" IS NOT NULL OR "deletedAt" IS NOT NULL)) THEN
     RAISE EXCEPTION 'Document is no longer available' USING ERRCODE = '23514';
   END IF;
 END LOOP;
 RETURN NEW;
END $$;
--> statement-breakpoint
DO $$ DECLARE ref record; BEGIN
 FOR ref IN SELECT c.conrelid::regclass AS relation, a.attname AS col
   FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
   WHERE c.contype = 'f' AND c.confrelid = 'public.documents'::regclass
 LOOP
   EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF %I ON %s FOR EACH ROW EXECUTE FUNCTION public.retention_reference_guard(%L, %L)',
     'retention_' || ref.col, ref.col, ref.relation, ref.col, 'scalar');
 END LOOP;
END $$;
--> statement-breakpoint
CREATE TRIGGER retention_document_ids BEFORE INSERT OR UPDATE OF "documentIds" ON service_request_updates
FOR EACH ROW EXECUTE FUNCTION public.retention_reference_guard('documentIds', 'array');
--> statement-breakpoint
CREATE TRIGGER retention_evidence_ids BEFORE INSERT OR UPDATE OF "evidenceDocumentIds" ON reconciliation_items
FOR EACH ROW EXECUTE FUNCTION public.retention_reference_guard('evidenceDocumentIds', 'array');
--> statement-breakpoint
CREATE FUNCTION public.retention_hold_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE customer_id uuid;
BEGIN
 customer_id := (to_jsonb(NEW)->>'customerId')::uuid;
 IF TG_TABLE_NAME IN ('reconciliation_items', 'payment_refunds') THEN
   SELECT "customerId" INTO customer_id FROM payments WHERE id = (to_jsonb(NEW)->>'paymentId')::uuid;
   IF customer_id IS NULL THEN
     SELECT "customerId" INTO customer_id FROM policies WHERE "policyNumber" = to_jsonb(NEW)->>'policyNumber';
   END IF;
 END IF;
 IF customer_id IS NULL THEN
   SELECT "customerId" INTO customer_id FROM policies WHERE "policyNumber" = to_jsonb(NEW)->>'policyNumber';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(customer_id::text, 16));
 IF EXISTS (SELECT 1 FROM documents d WHERE d."deletionStartedAt" IS NOT NULL AND d."deletedAt" IS NULL
   AND customer_id IN (SELECT public.retention_document_owners(d.id))) THEN
   RAISE EXCEPTION 'Retention deletion in progress; retry the operation' USING ERRCODE = '40001';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
DO $$ DECLARE relation text; BEGIN
 FOREACH relation IN ARRAY ARRAY['policies', 'claim_notifications', 'service_requests', 'payments', 'reconciliation_items', 'payment_refunds'] LOOP
   EXECUTE format('CREATE TRIGGER retention_hold BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION public.retention_hold_guard()', relation);
 END LOOP;
END $$;

--> statement-breakpoint
CREATE INDEX "documents_pending_deletion_idx" ON "documents" USING btree ("uploadedByCustomerId","id") WHERE "documents"."deletionStartedAt" IS NOT NULL AND "documents"."deletedAt" IS NULL;
