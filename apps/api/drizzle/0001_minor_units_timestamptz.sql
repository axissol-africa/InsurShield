-- Money becomes integer ngwee and rates basis points, under new names so a build that
-- still reads the old columns fails instead of reading ngwee as Kwacha. Timestamps were
-- written as UTC wall time and become timestamptz at the same instant.
ALTER TABLE "customers"
  ALTER COLUMN "emailVerifiedAt" SET DATA TYPE timestamptz(3) USING "emailVerifiedAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "updatedAt" SET DATA TYPE timestamptz(3) USING "updatedAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "deletedAt" SET DATA TYPE timestamptz(3) USING "deletedAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "createdAt" SET DATA TYPE timestamptz(3) USING "createdAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint
ALTER TABLE "consent_records"
  ALTER COLUMN "acceptedAt" SET DATA TYPE timestamptz(3) USING "acceptedAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "acceptedAt" SET DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint
ALTER TABLE "staff_users"
  ALTER COLUMN "lastLoginAt" SET DATA TYPE timestamptz(3) USING "lastLoginAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "updatedAt" SET DATA TYPE timestamptz(3) USING "updatedAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "createdAt" SET DATA TYPE timestamptz(3) USING "createdAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint
ALTER TABLE "insurers" RENAME COLUMN "ratePercentage" TO "rateBps";
--> statement-breakpoint
ALTER TABLE "insurers"
  ALTER COLUMN "rateBps" SET DATA TYPE integer USING round("rateBps" * 100)::integer,
  ALTER COLUMN "licenceExpiry" SET DATA TYPE timestamptz(3) USING "licenceExpiry" AT TIME ZONE 'UTC',
  ALTER COLUMN "updatedAt" SET DATA TYPE timestamptz(3) USING "updatedAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "deletedAt" SET DATA TYPE timestamptz(3) USING "deletedAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "createdAt" SET DATA TYPE timestamptz(3) USING "createdAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP,
  ADD CONSTRAINT "insurers_rateBps_check" CHECK ("rateBps" >= 0 AND "rateBps" <= 10000);
--> statement-breakpoint
ALTER TABLE "insurer_integrations"
  ALTER COLUMN "activatedAt" SET DATA TYPE timestamptz(3) USING "activatedAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "updatedAt" SET DATA TYPE timestamptz(3) USING "updatedAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "createdAt" SET DATA TYPE timestamptz(3) USING "createdAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint
ALTER TABLE "documents"
  ALTER COLUMN "uploadedAt" SET DATA TYPE timestamptz(3) USING "uploadedAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "uploadedAt" SET DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint
ALTER TABLE "vehicles"
  ALTER COLUMN "registrationDate" SET DATA TYPE timestamptz(3) USING "registrationDate" AT TIME ZONE 'UTC',
  ALTER COLUMN "rtsaAnniversaryDate" SET DATA TYPE timestamptz(3) USING "rtsaAnniversaryDate" AT TIME ZONE 'UTC',
  ALTER COLUMN "updatedAt" SET DATA TYPE timestamptz(3) USING "updatedAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "createdAt" SET DATA TYPE timestamptz(3) USING "createdAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint
ALTER TABLE "quote_requests" RENAME COLUMN "vehicleValue" TO "vehicleValueMinor";
--> statement-breakpoint
ALTER TABLE "quote_requests"
  ALTER COLUMN "vehicleValueMinor" SET DATA TYPE bigint USING round("vehicleValueMinor" * 100)::bigint,
  ALTER COLUMN "expiresAt" SET DATA TYPE timestamptz(3) USING "expiresAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "rtsaRegistrationDate" SET DATA TYPE timestamptz(3) USING "rtsaRegistrationDate" AT TIME ZONE 'UTC',
  ALTER COLUMN "policyStartDate" SET DATA TYPE timestamptz(3) USING "policyStartDate" AT TIME ZONE 'UTC',
  ALTER COLUMN "policyEndDate" SET DATA TYPE timestamptz(3) USING "policyEndDate" AT TIME ZONE 'UTC',
  ALTER COLUMN "photosCapturedAt" SET DATA TYPE timestamptz(3) USING "photosCapturedAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "updatedAt" SET DATA TYPE timestamptz(3) USING "updatedAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "submittedAt" SET DATA TYPE timestamptz(3) USING "submittedAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "submittedAt" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "createdAt" SET DATA TYPE timestamptz(3) USING "createdAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP,
  ADD CONSTRAINT "quote_requests_vehicleValueMinor_check" CHECK ("vehicleValueMinor" >= 0 AND "vehicleValueMinor" <= 99999999999999);
--> statement-breakpoint
ALTER TABLE "quote_request_recipients"
  ALTER COLUMN "deliveredAt" SET DATA TYPE timestamptz(3) USING "deliveredAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "acknowledgedAt" SET DATA TYPE timestamptz(3) USING "acknowledgedAt" AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE "insurer_quotes" RENAME COLUMN "premium" TO "premiumMinor";
--> statement-breakpoint
ALTER TABLE "insurer_quotes"
  ALTER COLUMN "premiumMinor" SET DATA TYPE bigint USING round("premiumMinor" * 100)::bigint,
  ALTER COLUMN "validUntil" SET DATA TYPE timestamptz(3) USING "validUntil" AT TIME ZONE 'UTC',
  ALTER COLUMN "extendedAt" SET DATA TYPE timestamptz(3) USING "extendedAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "sentAt" SET DATA TYPE timestamptz(3) USING "sentAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "sentAt" SET DEFAULT CURRENT_TIMESTAMP,
  ADD CONSTRAINT "insurer_quotes_premiumMinor_check" CHECK ("premiumMinor" >= 0 AND "premiumMinor" <= 99999999999999);
--> statement-breakpoint
ALTER TABLE "inspection_shots"
  ALTER COLUMN "capturedAt" SET DATA TYPE timestamptz(3) USING "capturedAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "capturedAt" SET DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint
ALTER TABLE "payments" RENAME COLUMN "amount" TO "amountMinor";
--> statement-breakpoint
ALTER TABLE "payments"
  ALTER COLUMN "amountMinor" SET DATA TYPE bigint USING round("amountMinor" * 100)::bigint,
  ALTER COLUMN "confirmedAt" SET DATA TYPE timestamptz(3) USING "confirmedAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "updatedAt" SET DATA TYPE timestamptz(3) USING "updatedAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "createdAt" SET DATA TYPE timestamptz(3) USING "createdAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP,
  ADD CONSTRAINT "payments_amountMinor_check" CHECK ("amountMinor" >= 0 AND "amountMinor" <= 99999999999999);
--> statement-breakpoint
ALTER TABLE "policies" RENAME COLUMN "premium" TO "premiumMinor";
--> statement-breakpoint
ALTER TABLE "policies"
  ALTER COLUMN "premiumMinor" SET DATA TYPE bigint USING round("premiumMinor" * 100)::bigint,
  ALTER COLUMN "policyStartDate" SET DATA TYPE timestamptz(3) USING "policyStartDate" AT TIME ZONE 'UTC',
  ALTER COLUMN "policyEndDate" SET DATA TYPE timestamptz(3) USING "policyEndDate" AT TIME ZONE 'UTC',
  ALTER COLUMN "issuedAt" SET DATA TYPE timestamptz(3) USING "issuedAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "updatedAt" SET DATA TYPE timestamptz(3) USING "updatedAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "receivedAt" SET DATA TYPE timestamptz(3) USING "receivedAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "receivedAt" SET DEFAULT CURRENT_TIMESTAMP,
  ADD CONSTRAINT "policies_premiumMinor_check" CHECK ("premiumMinor" >= 0 AND "premiumMinor" <= 99999999999999);
--> statement-breakpoint
ALTER TABLE "claim_notifications" RENAME COLUMN "estimatedLoss" TO "estimatedLossMinor";
--> statement-breakpoint
ALTER TABLE "claim_notifications"
  ALTER COLUMN "estimatedLossMinor" SET DATA TYPE bigint USING round("estimatedLossMinor" * 100)::bigint,
  ALTER COLUMN "incidentDate" SET DATA TYPE timestamptz(3) USING "incidentDate" AT TIME ZONE 'UTC',
  ALTER COLUMN "receivedAt" SET DATA TYPE timestamptz(3) USING "receivedAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "submittedAt" SET DATA TYPE timestamptz(3) USING "submittedAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "submittedAt" SET DEFAULT CURRENT_TIMESTAMP,
  ADD CONSTRAINT "claim_notifications_estimatedLossMinor_check" CHECK ("estimatedLossMinor" >= 0 AND "estimatedLossMinor" <= 99999999999999);
--> statement-breakpoint
ALTER TABLE "ncd_applications"
  ALTER COLUMN "decidedAt" SET DATA TYPE timestamptz(3) USING "decidedAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "submittedAt" SET DATA TYPE timestamptz(3) USING "submittedAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "submittedAt" SET DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint
ALTER TABLE "ncd_codes"
  ALTER COLUMN "expiresAt" SET DATA TYPE timestamptz(3) USING "expiresAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "redeemedAt" SET DATA TYPE timestamptz(3) USING "redeemedAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "issuedAt" SET DATA TYPE timestamptz(3) USING "issuedAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "issuedAt" SET DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint
ALTER TABLE "inspections"
  ALTER COLUMN "preferredDate" SET DATA TYPE timestamptz(3) USING "preferredDate" AT TIME ZONE 'UTC',
  ALTER COLUMN "scheduledDate" SET DATA TYPE timestamptz(3) USING "scheduledDate" AT TIME ZONE 'UTC',
  ALTER COLUMN "updatedAt" SET DATA TYPE timestamptz(3) USING "updatedAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "createdAt" SET DATA TYPE timestamptz(3) USING "createdAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint
ALTER TABLE "pia_config" RENAME COLUMN "piaRatePercentage" TO "piaRateBps";
--> statement-breakpoint
ALTER TABLE "pia_config"
  ALTER COLUMN "piaRateBps" SET DATA TYPE integer USING round("piaRateBps" * 100)::integer,
  ALTER COLUMN "updatedAt" SET DATA TYPE timestamptz(3) USING "updatedAt" AT TIME ZONE 'UTC',
  ADD CONSTRAINT "pia_config_piaRateBps_check" CHECK ("piaRateBps" >= 0 AND "piaRateBps" <= 10000);
--> statement-breakpoint
ALTER TABLE "idempotency_records"
  ALTER COLUMN "expiresAt" SET DATA TYPE timestamptz(3) USING "expiresAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "createdAt" SET DATA TYPE timestamptz(3) USING "createdAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint
ALTER TABLE "integration_deliveries"
  ALTER COLUMN "createdAt" SET DATA TYPE timestamptz(3) USING "createdAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint
ALTER TABLE "audit_logs"
  ALTER COLUMN "createdAt" SET DATA TYPE timestamptz(3) USING "createdAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP;
