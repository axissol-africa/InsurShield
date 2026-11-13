CREATE TABLE "support_password_reset_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"customerId" uuid NOT NULL,
	"requestedByStaffId" uuid NOT NULL,
	"deliveryChannel" text DEFAULT 'EMAIL' NOT NULL,
	"reason" text NOT NULL,
	"deliveryStatus" "DeliveryStatus" DEFAULT 'PENDING' NOT NULL,
	"deliveryProvider" text,
	"deliveryReference" text,
	"deliveredAt" timestamp (3) with time zone,
	"failedAt" timestamp (3) with time zone,
	"createdAt" timestamp (3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "support_password_reset_attempts_deliveryChannel_check" CHECK ("support_password_reset_attempts"."deliveryChannel" = 'EMAIL'),
	CONSTRAINT "support_password_reset_attempts_reason_check" CHECK (length(btrim("support_password_reset_attempts"."reason")) >= 10)
);
--> statement-breakpoint
ALTER TABLE "support_password_reset_attempts" ADD CONSTRAINT "support_password_reset_attempts_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE cascade;
--> statement-breakpoint
ALTER TABLE "support_password_reset_attempts" ADD CONSTRAINT "support_password_reset_attempts_requestedByStaffId_fkey" FOREIGN KEY ("requestedByStaffId") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE cascade;
--> statement-breakpoint
CREATE INDEX "support_password_reset_attempts_customerId_createdAt_idx" ON "support_password_reset_attempts" USING btree ("customerId","createdAt");
--> statement-breakpoint
CREATE INDEX "support_password_reset_attempts_requestedByStaffId_createdAt_idx" ON "support_password_reset_attempts" USING btree ("requestedByStaffId","createdAt");
