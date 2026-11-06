ALTER TABLE "idempotency_records" ADD COLUMN "callerId" text;--> statement-breakpoint
UPDATE "idempotency_records" SET "callerId" = 'legacy-migration:' || "key" WHERE "callerId" IS NULL;--> statement-breakpoint
ALTER TABLE "idempotency_records" ALTER COLUMN "callerId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "idempotency_records" DROP CONSTRAINT "idempotency_records_pkey";--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_records_callerId_endpoint_key_key" ON "idempotency_records" USING btree ("callerId","endpoint","key");
