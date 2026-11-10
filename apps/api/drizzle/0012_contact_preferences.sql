CREATE TYPE "public"."NotificationCategory" AS ENUM('QUOTE', 'PAYMENT', 'POLICY', 'CLAIM', 'NCD', 'INSPECTION', 'ACCOUNT', 'MARKETING');--> statement-breakpoint
CREATE TABLE "contact_preferences" (
	"id" uuid PRIMARY KEY NOT NULL,
	"customerId" uuid NOT NULL,
	"category" "NotificationCategory" NOT NULL,
	"channel" "NotificationChannel" NOT NULL,
	"enabled" boolean NOT NULL,
	"updatedAt" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketing_consents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"customerId" uuid NOT NULL,
	"granted" boolean NOT NULL,
	"noticeVersion" text NOT NULL,
	"purpose" text NOT NULL,
	"recordedAt" timestamp (3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"ipAddress" text,
	"userAgent" text
);
--> statement-breakpoint
-- Added nullable, backfilled, then made NOT NULL. These two tables arrived one
-- migration ago and are empty in every deployed environment, but a migration
-- that only works on an empty table is a migration that works by luck.
-- ACCOUNT and mandatory are the safe reading of a row written before categories
-- existed: it was sent unconditionally, because nothing could suppress it.
ALTER TABLE "notification_templates" ADD COLUMN "category" "NotificationCategory";--> statement-breakpoint
UPDATE "notification_templates" SET "category" = 'ACCOUNT' WHERE "category" IS NULL;--> statement-breakpoint
ALTER TABLE "notification_templates" ALTER COLUMN "category" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "category" "NotificationCategory";--> statement-breakpoint
UPDATE "notifications" SET "category" = 'ACCOUNT' WHERE "category" IS NULL;--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "category" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "mandatory" boolean;--> statement-breakpoint
UPDATE "notifications" SET "mandatory" = true WHERE "mandatory" IS NULL;--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "mandatory" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "contact_preferences" ADD CONSTRAINT "contact_preferences_customerId_customers_id_fk" FOREIGN KEY ("customerId") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_consents" ADD CONSTRAINT "marketing_consents_customerId_customers_id_fk" FOREIGN KEY ("customerId") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contact_preferences_customerId_category_channel_key" ON "contact_preferences" USING btree ("customerId","category","channel");--> statement-breakpoint
CREATE INDEX "marketing_consents_customerId_recordedAt_idx" ON "marketing_consents" USING btree ("customerId","recordedAt");