-- A submitted quote owns an immutable vehicle snapshot. Older builds could point
-- several requests at one row; retain the first request's row and copy it for the
-- later requests in deterministic request-id order.
WITH ranked_requests AS (
  SELECT
    qr.id AS quote_request_id,
    gen_random_uuid() AS copied_vehicle_id,
    v."plateNumber",
    v.make,
    v.model,
    v.year,
    v.color,
    v."chassisNumber",
    v."engineNumber",
    v."registrationDate",
    v."rtsaAnniversaryDate",
    v."createdAt",
    v."updatedAt",
    v."registrationCountry",
    row_number() OVER (PARTITION BY qr."vehicleId" ORDER BY qr.id) AS position
  FROM quote_requests qr
  INNER JOIN vehicles v ON v.id = qr."vehicleId"
), copies AS (
  SELECT * FROM ranked_requests WHERE position > 1
), inserted_vehicles AS (
  INSERT INTO vehicles (
    id,
    "plateNumber",
    make,
    model,
    year,
    color,
    "chassisNumber",
    "engineNumber",
    "registrationDate",
    "rtsaAnniversaryDate",
    "createdAt",
    "updatedAt",
    "registrationCountry"
  )
  SELECT
    copied_vehicle_id,
    "plateNumber",
    make,
    model,
    year,
    color,
    "chassisNumber",
    "engineNumber",
    "registrationDate",
    "rtsaAnniversaryDate",
    "createdAt",
    "updatedAt",
    "registrationCountry"
  FROM copies
  RETURNING id
)
UPDATE quote_requests qr
SET "vehicleId" = copies.copied_vehicle_id
FROM copies
INNER JOIN inserted_vehicles ON inserted_vehicles.id = copies.copied_vehicle_id
WHERE qr.id = copies.quote_request_id;
--> statement-breakpoint
UPDATE policies p
SET "vehicleId" = qr."vehicleId"
FROM quote_requests qr
WHERE p."quoteRequestId" = qr.id
  AND p."vehicleId" IS DISTINCT FROM qr."vehicleId";
