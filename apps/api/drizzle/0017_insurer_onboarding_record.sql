-- The reviewable onboarding record US-ADM-002 asks for.
--
-- An insurer was a row somebody created. It becomes a record that is reviewed:
-- the documents it is licensed and compliant on, the dates its approval runs
-- between, who approved it, and on what conditions. Activation then has
-- something to refuse on, which FR-ADM-007 requires while evidence is
-- incomplete, expired or unapproved.
--
-- Agreements are an evidence kind rather than a table of their own: they are
-- reviewed and they expire exactly as a licence does, and nothing yet asks
-- anything else of them.
--
-- Evidence needs a document kind of its own, because none of the existing ones
-- is about the insurer rather than a customer's risk, policy or claim -- and a
-- retention class of its own, because a licence is kept for as long as a
-- regulator asks rather than as long as a quotation. The class is stored at
-- upload and never re-derived, so putting it in an existing class could not be
-- corrected afterwards.
--
-- Evidence expiry is a `date`, like every business date added since the
-- conversion, and lapses at the end of its day in Lusaka -- the same boundary
-- the licence check uses, from the same function.
--
-- clientSecretEncrypted becomes nullable so the technical model can be captured
-- without it. Holding a secret needs a decision about where its key lives, and
-- nothing calls an insurer API until batch 9.
--
-- No row changes. Every insurer keeps its status, nothing is activated here,
-- and the insurers that predate this have no evidence on file -- which is what
-- B7.7 gives them, and why activation would refuse them until it does.
CREATE TYPE "public"."EvidenceKind" AS ENUM('LICENCE', 'TAX_CLEARANCE', 'INCORPORATION', 'AGREEMENT', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."EvidenceReviewState" AS ENUM('PENDING', 'APPROVED', 'REJECTED');--> statement-breakpoint
ALTER TYPE "public"."DocumentKind" ADD VALUE 'INSURER_EVIDENCE';--> statement-breakpoint
ALTER TYPE "public"."DocumentRetentionClass" ADD VALUE 'COMPLIANCE_EVIDENCE';--> statement-breakpoint
CREATE TABLE "insurer_evidence" (
	"id" uuid PRIMARY KEY NOT NULL,
	"insurerId" uuid NOT NULL,
	"kind" "EvidenceKind" NOT NULL,
	"documentId" uuid NOT NULL,
	"reference" text,
	"expiresAt" date,
	"state" "EvidenceReviewState" DEFAULT 'PENDING' NOT NULL,
	"reviewedBy" uuid,
	"reviewedAt" timestamp (3) with time zone,
	"note" text,
	"createdAt" timestamp (3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "insurer_integrations" ALTER COLUMN "clientSecretEncrypted" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "insurers" ADD COLUMN "effectiveFrom" date;--> statement-breakpoint
ALTER TABLE "insurers" ADD COLUMN "renewalDate" date;--> statement-breakpoint
ALTER TABLE "insurers" ADD COLUMN "approvedBy" uuid;--> statement-breakpoint
ALTER TABLE "insurers" ADD COLUMN "approvedAt" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "insurers" ADD COLUMN "activationConditions" text;--> statement-breakpoint
ALTER TABLE "insurer_evidence" ADD CONSTRAINT "insurer_evidence_insurerId_fkey" FOREIGN KEY ("insurerId") REFERENCES "public"."insurers"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "insurer_evidence" ADD CONSTRAINT "insurer_evidence_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "insurer_evidence" ADD CONSTRAINT "insurer_evidence_reviewedBy_fkey" FOREIGN KEY ("reviewedBy") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "insurer_evidence_insurerId_kind_idx" ON "insurer_evidence" USING btree ("insurerId","kind");