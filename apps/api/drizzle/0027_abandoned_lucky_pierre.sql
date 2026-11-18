CREATE TYPE "public"."IntegrationTargetKind" AS ENUM('INSURER_API', 'RTSA', 'PAYMENT_GATEWAY');--> statement-breakpoint
ALTER TYPE "public"."DeliveryKind" ADD VALUE 'VEHICLE_LOOKUP';--> statement-breakpoint
ALTER TYPE "public"."DeliveryKind" ADD VALUE 'PAYMENT_CONFIRMATION';--> statement-breakpoint
ALTER TYPE "public"."DeliveryKind" ADD VALUE 'POLICY_ISSUED';--> statement-breakpoint
ALTER TYPE "public"."DeliveryStatus" ADD VALUE 'MANUAL_FALLBACK';--> statement-breakpoint
CREATE TABLE "integration_callbacks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"insurerId" uuid NOT NULL,
	"eventId" varchar(200) NOT NULL,
	"eventType" varchar(120) NOT NULL,
	"bodyHash" varchar(64) NOT NULL,
	"correlationId" text,
	"receivedAt" timestamp (3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "integration_deliveries" ALTER COLUMN "insurerId" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "integration_deliveries" ALTER COLUMN "attempt" SET DEFAULT 0;--> statement-breakpoint
-- The table predates the integration service. Add every new required column in
-- stages so a populated database remains readable throughout this migration.
ALTER TABLE "integration_deliveries" ADD COLUMN "targetKind" "IntegrationTargetKind";--> statement-breakpoint
UPDATE "integration_deliveries" SET "targetKind" = 'INSURER_API'::"IntegrationTargetKind" WHERE "targetKind" IS NULL;--> statement-breakpoint
ALTER TABLE "integration_deliveries" ALTER COLUMN "targetKind" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "integration_deliveries" ADD COLUMN "idempotencyKey" varchar(200);--> statement-breakpoint
UPDATE "integration_deliveries" SET "idempotencyKey" = 'legacy:' || "id"::text WHERE "idempotencyKey" IS NULL;--> statement-breakpoint
ALTER TABLE "integration_deliveries" ALTER COLUMN "idempotencyKey" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "integration_deliveries" ADD COLUMN "requestHash" varchar(64);--> statement-breakpoint
UPDATE "integration_deliveries" SET "requestHash" = md5("id"::text) WHERE "requestHash" IS NULL;--> statement-breakpoint
ALTER TABLE "integration_deliveries" ALTER COLUMN "requestHash" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "integration_deliveries" ADD COLUMN "correlationId" text;--> statement-breakpoint
ALTER TABLE "integration_deliveries" ADD COLUMN "maxAttempts" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "integration_deliveries" ADD COLUMN "lastAttemptAt" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "integration_deliveries" ADD COLUMN "deliveredAt" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "integration_deliveries" ADD COLUMN "acknowledgedAt" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "integration_deliveries" ADD COLUMN "resolvedAt" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "integration_deliveries" ADD COLUMN "resolvedByStaffId" uuid;--> statement-breakpoint
ALTER TABLE "integration_deliveries" ADD COLUMN "resolutionNote" text;--> statement-breakpoint
ALTER TABLE "integration_callbacks" ADD CONSTRAINT "integration_callbacks_insurerId_fkey" FOREIGN KEY ("insurerId") REFERENCES "public"."insurers"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "integration_callbacks_insurerId_eventId_key" ON "integration_callbacks" USING btree ("insurerId","eventId");--> statement-breakpoint
CREATE INDEX "integration_callbacks_insurerId_receivedAt_idx" ON "integration_callbacks" USING btree ("insurerId","receivedAt");--> statement-breakpoint
ALTER TABLE "integration_deliveries" ADD CONSTRAINT "integration_deliveries_resolvedByStaffId_fkey" FOREIGN KEY ("resolvedByStaffId") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "integration_deliveries_idempotencyKey_key" ON "integration_deliveries" USING btree ("idempotencyKey");--> statement-breakpoint
CREATE INDEX "integration_deliveries_targetKind_status_createdAt_idx" ON "integration_deliveries" USING btree ("targetKind","status","createdAt");
