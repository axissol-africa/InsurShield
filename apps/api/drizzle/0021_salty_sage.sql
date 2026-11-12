CREATE TYPE "public"."ApprovalAction" AS ENUM('PIA_FLOOR_CHANGE', 'INSURER_ACTIVATE', 'INSURER_DEACTIVATE', 'INSURER_SUSPEND', 'INSURER_DELETE', 'INSURER_RESTORE');--> statement-breakpoint
CREATE TYPE "public"."ApprovalStatus" AS ENUM('PENDING', 'REJECTED', 'EXPIRED', 'EXECUTED');--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"action" "ApprovalAction" NOT NULL,
	"status" "ApprovalStatus" DEFAULT 'PENDING' NOT NULL,
	"targetType" text NOT NULL,
	"targetId" text NOT NULL,
	"payload" jsonb NOT NULL,
	"requestedByStaffId" uuid NOT NULL,
	"requestedReason" text NOT NULL,
	"decidedByStaffId" uuid,
	"decisionReason" text,
	"expiresAt" timestamp (3) with time zone NOT NULL,
	"decidedAt" timestamp (3) with time zone,
	"executedAt" timestamp (3) with time zone,
	"createdAt" timestamp (3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requestedByStaffId_fkey" FOREIGN KEY ("requestedByStaffId") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_decidedByStaffId_fkey" FOREIGN KEY ("decidedByStaffId") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "approval_requests_status_createdAt_idx" ON "approval_requests" USING btree ("status","createdAt");--> statement-breakpoint
CREATE INDEX "approval_requests_target_idx" ON "approval_requests" USING btree ("targetType","targetId");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_requests_one_pending_action_key" ON "approval_requests" USING btree ("action","targetType","targetId") WHERE "approval_requests"."status" = 'PENDING';