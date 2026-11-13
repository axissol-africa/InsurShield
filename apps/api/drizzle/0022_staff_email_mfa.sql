ALTER TABLE "auth_users" ADD COLUMN "twoFactorEnabled" boolean DEFAULT false;
--> statement-breakpoint
CREATE TABLE "auth_two_factors" (
	"id" uuid PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"backupCodes" text NOT NULL,
	"userId" uuid NOT NULL,
	"verified" boolean DEFAULT true,
	"failedVerificationCount" integer DEFAULT 0,
	"lockedUntil" timestamp (3) with time zone
);
--> statement-breakpoint
ALTER TABLE "auth_two_factors" ADD CONSTRAINT "auth_two_factors_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE cascade;
--> statement-breakpoint
CREATE INDEX "auth_two_factors_secret_idx" ON "auth_two_factors" USING btree ("secret");
--> statement-breakpoint
CREATE INDEX "auth_two_factors_userId_idx" ON "auth_two_factors" USING btree ("userId");
--> statement-breakpoint
CREATE INDEX "auth_two_factors_lockedUntil_idx" ON "auth_two_factors" USING btree ("lockedUntil");
--> statement-breakpoint
-- Existing staff become email-code MFA users; customer identities remain unchanged.
UPDATE "auth_users" AS user_row
SET "twoFactorEnabled" = true
FROM "staff_users" AS staff
WHERE staff."userId" = user_row."id";
--> statement-breakpoint
-- A password-only session issued before MFA was introduced must not survive the rollout.
DELETE FROM "auth_sessions" AS session_row
USING "staff_users" AS staff
WHERE session_row."userId" = staff."userId";
--> statement-breakpoint
INSERT INTO "auth_two_factors" ("id", "secret", "backupCodes", "userId", "verified", "failedVerificationCount")
SELECT gen_random_uuid(), md5(random()::text || clock_timestamp()::text), md5(random()::text || clock_timestamp()::text), staff."userId", true, 0
FROM "staff_users" AS staff
WHERE staff."userId" IS NOT NULL
AND NOT EXISTS (SELECT 1 FROM "auth_two_factors" WHERE "auth_two_factors"."userId" = staff."userId");
