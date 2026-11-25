ALTER TYPE "public"."RuleSettingKey" ADD VALUE 'RENEWAL_POLICY';--> statement-breakpoint
CREATE TABLE "renewal_reminders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"policyNumber" text NOT NULL,
	"kind" varchar(10) NOT NULL,
	"daysBefore" integer NOT NULL,
	"sentAt" timestamp (3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "renewal_reminders_kind_check" CHECK ("renewal_reminders"."kind" IN ('DUE', 'LAPSED'))
);
--> statement-breakpoint
ALTER TABLE "renewal_reminders" ADD CONSTRAINT "renewal_reminders_policyNumber_fkey" FOREIGN KEY ("policyNumber") REFERENCES "public"."policies"("policyNumber") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "renewal_reminders_policyNumber_kind_daysBefore_key" ON "renewal_reminders" USING btree ("policyNumber","kind","daysBefore");--> statement-breakpoint
INSERT INTO "notification_templates" ("id", "key", "channel", "category", "version", "subject", "body", "mandatory", "activeFrom")
VALUES
  (gen_random_uuid(), 'policy.renewal_due', 'IN_APP', 'POLICY', 1,
   'Your cover ends soon',
   'Policy {{policyNumber}} with {{insurer}} ends on {{endDate}}, in {{daysRemaining}} days. Renew to compare current products and stay covered.', false, '1970-01-01T00:00:00Z'),
  (gen_random_uuid(), 'policy.renewal_due', 'EMAIL', 'POLICY', 1,
   'Your motor cover ends on {{endDate}}',
   'Policy {{policyNumber}} with {{insurer}} ends on {{endDate}}, in {{daysRemaining}} days. Sign in to InsurShield to renew: your vehicle and cover details carry over, and you can compare current products before you pay.', false, '1970-01-01T00:00:00Z'),
  (gen_random_uuid(), 'policy.lapsed', 'IN_APP', 'POLICY', 1,
   'Your cover has ended',
   'Policy {{policyNumber}} with {{insurer}} ended on {{endDate}}. Your vehicle is not covered by it any more. Renew to get new cover.', false, '1970-01-01T00:00:00Z'),
  (gen_random_uuid(), 'policy.lapsed', 'EMAIL', 'POLICY', 1,
   'Your motor cover has ended',
   'Policy {{policyNumber}} with {{insurer}} ended on {{endDate}}, and your vehicle is no longer covered by it. Sign in to InsurShield to get new cover.', false, '1970-01-01T00:00:00Z');
