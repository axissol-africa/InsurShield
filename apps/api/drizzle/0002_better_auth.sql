-- Additive only, so the Keycloak build keeps working on it: it never reads the new tables or
-- columns and still writes "keycloakId". Each domain table is altered last, in one group.
CREATE TABLE "auth_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"accountId" text NOT NULL,
	"providerId" text NOT NULL,
	"userId" uuid NOT NULL,
	"accessToken" text,
	"refreshToken" text,
	"idToken" text,
	"accessTokenExpiresAt" timestamp (3) with time zone,
	"refreshTokenExpiresAt" timestamp (3) with time zone,
	"scope" text,
	"password" text,
	"createdAt" timestamp (3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_rate_limits" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"lastRequest" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"expiresAt" timestamp (3) with time zone NOT NULL,
	"token" text NOT NULL,
	"createdAt" timestamp (3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp (3) with time zone NOT NULL,
	"ipAddress" text,
	"userAgent" text,
	"userId" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_sign_in_failures" (
	"emailKey" varchar(254) PRIMARY KEY NOT NULL,
	"attempts" integer NOT NULL,
	"windowStartedAt" timestamp (3) with time zone NOT NULL,
	"lockedUntil" timestamp (3) with time zone,
	CONSTRAINT "auth_sign_in_failures_emailKey_check" CHECK ("auth_sign_in_failures"."emailKey" = lower("auth_sign_in_failures"."emailKey"))
);
--> statement-breakpoint
CREATE TABLE "auth_users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"emailVerified" boolean DEFAULT false NOT NULL,
	"image" text,
	"createdAt" timestamp (3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "auth_users_email_check" CHECK ("auth_users"."email" = lower("auth_users"."email"))
);
--> statement-breakpoint
CREATE TABLE "auth_verifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expiresAt" timestamp (3) with time zone NOT NULL,
	"createdAt" timestamp (3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_accounts" ADD CONSTRAINT "auth_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_accounts_providerId_accountId_key" ON "auth_accounts" USING btree ("providerId","accountId");--> statement-breakpoint
CREATE INDEX "auth_accounts_userId_idx" ON "auth_accounts" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_rate_limits_key_key" ON "auth_rate_limits" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_sessions_token_key" ON "auth_sessions" USING btree ("token");--> statement-breakpoint
CREATE INDEX "auth_sessions_userId_idx" ON "auth_sessions" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "auth_sign_in_failures_windowStartedAt_idx" ON "auth_sign_in_failures" USING btree ("windowStartedAt");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_users_email_key" ON "auth_users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "auth_verifications_identifier_idx" ON "auth_verifications" USING btree ("identifier");--> statement-breakpoint
ALTER TABLE "customers" ALTER COLUMN "keycloakId" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "userId" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "customers_userId_key" ON "customers" USING btree ("userId");--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."auth_users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "staff_users" ALTER COLUMN "keycloakId" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_users" ADD COLUMN "userId" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_users_userId_key" ON "staff_users" USING btree ("userId");--> statement-breakpoint
ALTER TABLE "staff_users" ADD CONSTRAINT "staff_users_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."auth_users"("id") ON DELETE restrict ON UPDATE cascade;
