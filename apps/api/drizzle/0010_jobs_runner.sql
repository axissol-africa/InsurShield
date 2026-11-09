CREATE TYPE "public"."JobStatus" AS ENUM('PENDING', 'RUNNING', 'DONE', 'FAILED');--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "JobStatus" DEFAULT 'PENDING' NOT NULL,
	"runAfter" timestamp (3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"maxAttempts" integer DEFAULT 5 NOT NULL,
	"leaseUntil" timestamp (3) with time zone,
	"lastError" text,
	"createdAt" timestamp (3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"completedAt" timestamp (3) with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_kind_key_key" ON "jobs" USING btree ("kind","key");--> statement-breakpoint
CREATE INDEX "jobs_status_runAfter_idx" ON "jobs" USING btree ("status","runAfter");