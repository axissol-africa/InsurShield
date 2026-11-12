-- The insurers that predate onboarding, given the licence records the
-- new-business check needs.
--
-- None of the five carries a licence: the column has existed since batch 7
-- started and the seed never wrote it. They trade today only because the
-- eligibility rule reads a null expiry as current, which is the one permissive
-- point in that rule. The moment a licence has to be present -- or activation
-- is attempted, which reads the evidence table -- every one of them is refused,
-- and an empty fan-out list refuses every quote request with NO_ACTIVE_INSURERS.
--
-- The user's decision (2026-11-11) is to grandfather them to 2027-03-31. That
-- is a deadline, not a fact about any licence: each insurer must be onboarded
-- with real papers before it, and on 1 April 2027 an insurer that has not been
-- will stop receiving new business while continuing to service what it wrote.
--
-- Two things need filling, because two rules read different columns: the
-- eligibility rule reads insurers."licenceExpiry", and the activation gate
-- reads the evidence table. An insurer with only one of them passes one check
-- and fails the other.
--
-- Like the customer grandfathering in 0013, the record says what it is rather
-- than pretending to be a real one. A grandfathered licence has no scanned
-- document and no licence number, because nobody has produced either; a real
-- one has both. An audit can tell them apart without a flag:
--
--   SELECT * FROM insurer_evidence WHERE kind = 'LICENCE' AND "documentId" IS NULL;
--
-- Removed insurers are left alone. They are not trading and reviving one is a
-- deliberate act that goes through onboarding.
ALTER TABLE "insurer_evidence" ALTER COLUMN "documentId" DROP NOT NULL;--> statement-breakpoint
UPDATE "insurers"
   SET "licenceExpiry" = '2027-03-31T00:00:00.000Z'
 WHERE "licenceExpiry" IS NULL
   AND "status" <> 'DELETED';--> statement-breakpoint
INSERT INTO "insurer_evidence" ("id", "insurerId", "kind", "documentId", "expiresAt", "state", "reviewedAt", "note", "createdAt", "updatedAt")
SELECT gen_random_uuid(),
       i."id",
       'LICENCE',
       NULL,
       '2027-03-31',
       'APPROVED',
       now(),
       'Licensed under the grandfather clause of 2026-11-11. No document has been produced; re-onboard with the real licence before 2027-03-31.',
       now(),
       now()
  FROM "insurers" i
 WHERE i."status" <> 'DELETED'
   AND NOT EXISTS (
         SELECT 1 FROM "insurer_evidence" e
          WHERE e."insurerId" = i."id" AND e."kind" = 'LICENCE'
       );
