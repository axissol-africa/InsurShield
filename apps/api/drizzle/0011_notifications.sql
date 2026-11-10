CREATE TYPE "public"."NotificationChannel" AS ENUM('IN_APP', 'EMAIL');--> statement-breakpoint
CREATE TYPE "public"."NotificationDeliveryStatus" AS ENUM('PENDING', 'SENT', 'FAILED');--> statement-breakpoint
CREATE TABLE "notification_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"channel" "NotificationChannel" NOT NULL,
	"version" integer NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"mandatory" boolean DEFAULT true NOT NULL,
	"activeFrom" timestamp (3) with time zone,
	"createdAt" timestamp (3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"customerId" uuid NOT NULL,
	"templateKey" text NOT NULL,
	"templateVersion" integer NOT NULL,
	"channel" "NotificationChannel" NOT NULL,
	"entityType" text NOT NULL,
	"entityId" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"readAt" timestamp (3) with time zone,
	"deliveryStatus" "NotificationDeliveryStatus" DEFAULT 'PENDING' NOT NULL,
	"providerReference" text,
	"deliveredAt" timestamp (3) with time zone,
	"createdAt" timestamp (3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_customerId_customers_id_fk" FOREIGN KEY ("customerId") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_templates_key_channel_version_key" ON "notification_templates" USING btree ("key","channel","version");--> statement-breakpoint
CREATE INDEX "notification_templates_key_channel_activeFrom_idx" ON "notification_templates" USING btree ("key","channel","activeFrom");--> statement-breakpoint
CREATE INDEX "notifications_customerId_createdAt_idx" ON "notifications" USING btree ("customerId","createdAt");--> statement-breakpoint
CREATE INDEX "notifications_customerId_readAt_idx" ON "notifications" USING btree ("customerId","readAt");