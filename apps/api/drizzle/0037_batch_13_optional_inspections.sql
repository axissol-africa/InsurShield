-- Inspections are optional: the live photos taken in the journey are enough
-- under normal circumstances, and an inspection never holds up a quote or a
-- purchase. Products that migration 0033 or a submit left waiting for one go
-- back to waiting for the insurer, with their reply due date moved on by the
-- time they were held.
UPDATE "quote_request_product_versions"
SET "status" = 'SUBMITTED',
  "replyDueAt" = CASE
      WHEN "replyDueAt" IS NOT NULL AND "pausedAt" IS NOT NULL THEN "replyDueAt" + (CURRENT_TIMESTAMP - "pausedAt")
      ELSE "replyDueAt"
    END,
  "pausedAt" = NULL,
  "statusChangedAt" = CURRENT_TIMESTAMP
WHERE "status" = 'INSPECTION_REQUIRED';
