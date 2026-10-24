-- Rows in the Prisma-era schema. Timestamps are UTC wall time, as Prisma wrote them.
INSERT INTO "customers" ("id", "fullName", "email", "phone", "emailVerifiedAt", "createdAt", "updatedAt", "keycloakId") VALUES
  ('00000000-0000-4000-8000-000000000001', 'Ann Banda', 'ann@example.zm', '+260970000001', NULL, '2026-03-31 22:30:00.123', '2026-03-31 23:59:59.999', 'kc-ann');

INSERT INTO "staff_users" ("id", "email", "fullName", "role", "updatedAt", "keycloakId") VALUES
  ('00000000-0000-4000-8000-000000000002', 'admin@example.zm', 'Admin', 'ADMIN', '2026-01-01 00:00:00', 'kc-admin');

INSERT INTO "insurers" ("id", "name", "ratePercentage", "quoteValidityDays", "coverage", "benefits", "createdAt", "updatedAt") VALUES
  ('00000000-0000-4000-8000-000000000011', 'Benefits Null', 5.25, 14, 'Comprehensive', NULL, '2025-12-31 22:00:00', '2025-12-31 22:00:00'),
  ('00000000-0000-4000-8000-000000000012', 'Benefits Empty', 0.01, 14, 'Comprehensive', '{}', '2026-01-01 00:00:00', '2026-01-01 00:00:00'),
  ('00000000-0000-4000-8000-000000000013', 'Benefits Listed', 100.00, 30, 'Third party', '{"Roadside assistance","Windscreen, glass"}', '2026-01-01 00:00:00', '2026-01-01 00:00:00');

INSERT INTO "vehicles" ("id", "plateNumber", "make", "model", "year", "registrationDate", "updatedAt") VALUES
  ('00000000-0000-4000-8000-000000000021', 'ABC 1234', 'Toyota', 'Corolla', '2018', '2018-06-30 22:00:00', '2026-01-01 00:00:00');

INSERT INTO "documents" ("id", "kind", "fileName", "mimeType", "sizeBytes", "storageKey") VALUES
  ('00000000-0000-4000-8000-000000000031', 'QUOTATION', 'quote.pdf', 'application/pdf', 1024, 'quotes/q1.pdf'),
  ('00000000-0000-4000-8000-000000000032', 'QUOTATION', 'quote2.pdf', 'application/pdf', 1024, 'quotes/q2.pdf');

INSERT INTO "quote_requests" ("id", "expiresAt", "customerId", "vehicleId", "vehicleValue", "vehicleUsage", "insuranceType", "coverageDuration", "updatedAt") VALUES
  ('QR-1', '2026-04-30 21:59:59.999', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000021', 123456.78, 'Private', 'COMPREHENSIVE', 'Q4', '2026-03-31 22:30:00.123'),
  ('QR-2', '2026-04-30 22:00:00', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000021', 999999999999.99, 'Private', 'THIRD_PARTY', 'Q1', '2026-01-01 00:00:00'),
  ('QR-3', '2026-04-30 22:00:00', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000021', 0.00, 'Private', 'THIRD_PARTY', 'Q1', '2026-01-01 00:00:00');

INSERT INTO "insurer_quotes" ("id", "quoteRequestId", "insurerId", "premium", "validityDays", "validUntil", "documentId") VALUES
  ('00000000-0000-4000-8000-000000000041', 'QR-1', '00000000-0000-4000-8000-000000000011', 0.29, 14, '2026-04-14 21:59:59.999', '00000000-0000-4000-8000-000000000031'),
  ('00000000-0000-4000-8000-000000000042', 'QR-2', '00000000-0000-4000-8000-000000000013', 1005.50, 30, '2026-05-01 00:00:00', '00000000-0000-4000-8000-000000000032');

INSERT INTO "payments" ("id", "transactionId", "method", "amount", "idempotencyKey", "customerId", "quoteRequestId", "insurerQuoteId", "confirmedAt", "updatedAt") VALUES
  ('00000000-0000-4000-8000-000000000051', 'TX-1', 'MOBILE_MONEY', 0.29, 'key-1', '00000000-0000-4000-8000-000000000001', 'QR-1', '00000000-0000-4000-8000-000000000041', '2026-03-31 22:00:00', '2026-03-31 22:00:00');

INSERT INTO "policies" ("policyNumber", "insurerId", "customerId", "vehicleId", "coverage", "premium", "paymentId", "policyStartDate", "updatedAt") VALUES
  ('POL-1', '00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000021', 'Comprehensive', 1005.50, '00000000-0000-4000-8000-000000000051', '2026-03-31 22:00:00', '2026-03-31 22:00:00');

INSERT INTO "claim_notifications" ("claimNumber", "insurerId", "fullName", "phone", "plate", "vehicleLabel", "type", "incidentDate", "location", "description", "estimatedLoss") VALUES
  ('CL-1', '00000000-0000-4000-8000-000000000011', 'Ann Banda', '+260970000001', 'ABC 1234', 'Toyota Corolla', 'Collision', '2026-03-15 10:00:00', 'Lusaka', 'Rear-ended', NULL),
  ('CL-2', '00000000-0000-4000-8000-000000000011', 'Ann Banda', '+260970000001', 'ABC 1234', 'Toyota Corolla', 'Theft', '2026-03-16 10:00:00', 'Lusaka', 'Mirror taken', 0.01);

INSERT INTO "pia_config" ("id", "piaRatePercentage", "updatedByStaffId", "updatedAt") VALUES
  ('current', 2.50, '00000000-0000-4000-8000-000000000002', '2026-01-01 00:00:00');

INSERT INTO "idempotency_records" ("key", "endpoint", "requestHash", "responseStatus", "responseBody", "expiresAt") VALUES
  ('idem-sql-null', 'POST /payments', 'h1', NULL, NULL, '2026-04-01 00:00:00'),
  ('idem-json-null', 'POST /payments', 'h2', 200, 'null', '2026-04-01 00:00:00'),
  ('idem-object', 'POST /payments', 'h3', 201, '{"amount": 1005.5, "items": [1, "two", null], "nested": {"ok": true}}', '2026-04-01 00:00:00');

INSERT INTO "integration_deliveries" ("id", "insurerId", "kind", "referenceId", "endpoint", "requestPayload", "responseBody") VALUES
  ('00000000-0000-4000-8000-000000000061', '00000000-0000-4000-8000-000000000011', 'QUOTE_REQUEST', 'QR-1', 'https://insurer.example/quotes', '{"premium": "0.29"}', 'null'),
  ('00000000-0000-4000-8000-000000000062', '00000000-0000-4000-8000-000000000011', 'PAID_POLICY', 'POL-1', 'https://insurer.example/policies', '[]', NULL);

INSERT INTO "audit_logs" ("id", "actorType", "actorId", "action", "entityType", "entityId", "before", "after") VALUES
  ('00000000-0000-4000-8000-000000000071', 'STAFF', '00000000-0000-4000-8000-000000000002', 'insurer.update', 'insurer', '00000000-0000-4000-8000-000000000011', NULL, 'null'),
  ('00000000-0000-4000-8000-000000000072', 'SYSTEM', NULL, 'quote.expire', 'quote_request', 'QR-3', '{"status": "SUBMITTED"}', '{"status": "EXPIRED"}');

-- Every timestamp column holds a value in some row; NULLs stay in others.
UPDATE "customers" SET "emailVerifiedAt" = '2026-02-28 23:15:00.5', "deletedAt" = '2026-04-01 00:00:00.001';
UPDATE "staff_users" SET "lastLoginAt" = '2026-03-31 22:00:00.25';
UPDATE "insurers" SET "licenceExpiry" = '2027-01-01 00:00:00', "deletedAt" = '2026-03-31 23:00:00' WHERE "name" = 'Benefits Listed';
UPDATE "vehicles" SET "rtsaAnniversaryDate" = '2026-06-30 22:00:00';
UPDATE "quote_requests" SET "rtsaRegistrationDate" = '2018-06-30 22:00:00', "policyStartDate" = '2026-04-01 00:00:00',
  "policyEndDate" = '2026-06-30 21:59:59.999', "photosCapturedAt" = '2026-03-31 22:10:00' WHERE "id" = 'QR-1';
UPDATE "insurer_quotes" SET "extendedAt" = '2026-04-10 01:00:00' WHERE "quoteRequestId" = 'QR-1';
UPDATE "policies" SET "policyEndDate" = '2027-03-31 21:59:59.999', "issuedAt" = '2026-03-31 22:05:00';
UPDATE "claim_notifications" SET "receivedAt" = '2026-03-16 23:30:00' WHERE "claimNumber" = 'CL-2';

INSERT INTO "documents" ("id", "kind", "fileName", "mimeType", "sizeBytes", "storageKey", "uploadedAt") VALUES
  ('00000000-0000-4000-8000-000000000033', 'INSPECTION_PHOTO', 'front.jpg', 'image/jpeg', 2048, 'inspections/front.jpg', '2026-03-31 22:10:00');

INSERT INTO "consent_records" ("id", "customerId", "privacyVersion", "termsVersion", "acceptedAt") VALUES
  ('00000000-0000-4000-8000-000000000081', '00000000-0000-4000-8000-000000000001', 'v1', 'v1', '2026-03-31 22:29:59');

INSERT INTO "inspection_shots" ("id", "quoteRequestId", "shotKey", "documentId", "capturedAt") VALUES
  ('00000000-0000-4000-8000-000000000082', 'QR-1', 'front', '00000000-0000-4000-8000-000000000033', '2026-03-31 22:10:00.5');

INSERT INTO "inspections" ("id", "customerId", "vehiclePlate", "vehicleLabel", "preferredDate", "scheduledDate", "createdAt", "updatedAt") VALUES
  ('INS-1', '00000000-0000-4000-8000-000000000001', 'ABC 1234', 'Toyota Corolla', '2026-04-02 22:00:00', '2026-04-03 06:00:00', '2026-03-31 22:00:00', '2026-03-31 22:00:00'),
  ('INS-2', '00000000-0000-4000-8000-000000000001', 'ABC 1234', 'Toyota Corolla', NULL, NULL, '2026-04-01 00:00:00', '2026-04-01 00:00:00');

INSERT INTO "insurer_integrations" ("insurerId", "apiBaseUrl", "publicSigningKey", "clientId", "clientSecretEncrypted", "activatedAt", "createdAt", "updatedAt") VALUES
  ('00000000-0000-4000-8000-000000000011', 'https://insurer.example', 'key', 'client-1', 'secret', '2026-01-15 21:30:00', '2026-01-15 21:00:00', '2026-01-15 21:30:00'),
  ('00000000-0000-4000-8000-000000000012', 'https://other.example', 'key', 'client-2', 'secret', NULL, '2026-01-16 00:00:00', '2026-01-16 00:00:00');

INSERT INTO "ncd_codes" ("code", "insurerId", "percentage", "yearsClaimFree", "issuedAt", "expiresAt", "redeemedAt") VALUES
  ('NCD-1', '00000000-0000-4000-8000-000000000011', 10, 2, '2026-02-01 22:00:00', '2027-02-01 21:59:59.999', '2026-03-31 22:00:00'),
  ('NCD-2', '00000000-0000-4000-8000-000000000011', 20, 4, '2026-02-02 00:00:00', NULL, NULL);

INSERT INTO "ncd_applications" ("id", "applicationNumber", "insurerId", "policyNumber", "fullName", "phone", "yearsClaimFree", "submittedAt", "decidedAt") VALUES
  ('00000000-0000-4000-8000-000000000083', 'NCD-APP-1', '00000000-0000-4000-8000-000000000011', 'POL-OLD-1', 'Ann Banda', '+260970000001', 2, '2026-01-31 22:00:00', '2026-02-01 22:00:00'),
  ('00000000-0000-4000-8000-000000000084', 'NCD-APP-2', '00000000-0000-4000-8000-000000000011', 'POL-OLD-2', 'Ann Banda', '+260970000001', 4, '2026-02-01 00:00:00', NULL);

INSERT INTO "quote_request_recipients" ("id", "quoteRequestId", "insurerId", "deliveredAt", "acknowledgedAt") VALUES
  ('00000000-0000-4000-8000-000000000085', 'QR-1', '00000000-0000-4000-8000-000000000011', '2026-03-31 22:31:00', '2026-03-31 22:45:00.75'),
  ('00000000-0000-4000-8000-000000000086', 'QR-2', '00000000-0000-4000-8000-000000000013', NULL, NULL);
