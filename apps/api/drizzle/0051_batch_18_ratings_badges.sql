ALTER TYPE "public"."RuleSettingKey" ADD VALUE 'REPUTATION_POLICY';--> statement-breakpoint
CREATE TABLE "certificate_badge_snapshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"insurerId" uuid NOT NULL,
	"calculationDay" date NOT NULL,
	"generation" integer NOT NULL,
	"ruleVersion" integer NOT NULL,
	"qualifies" boolean NOT NULL,
	"eligible" boolean NOT NULL,
	"sampleCount" integer NOT NULL,
	"onTimeCount" integer NOT NULL,
	"minimumPolicies" integer NOT NULL,
	"thresholdBps" integer NOT NULL,
	"periodStart" timestamp (3) with time zone NOT NULL,
	"periodEnd" timestamp (3) with time zone NOT NULL,
	"calculatedAt" timestamp (3) with time zone NOT NULL,
	"expiresAt" timestamp (3) with time zone NOT NULL,
	"dataSource" text NOT NULL,
	"method" text NOT NULL,
	"disclaimer" text NOT NULL,
	CONSTRAINT "certificate_badge_snapshots_counts_check" CHECK ("certificate_badge_snapshots"."sampleCount" >= 0 AND "certificate_badge_snapshots"."onTimeCount" >= 0 AND "certificate_badge_snapshots"."onTimeCount" <= "certificate_badge_snapshots"."sampleCount"),
	CONSTRAINT "certificate_badge_snapshots_rules_check" CHECK ("certificate_badge_snapshots"."minimumPolicies" > 0 AND "certificate_badge_snapshots"."thresholdBps" BETWEEN 0 AND 10000 AND "certificate_badge_snapshots"."ruleVersion" > 0 AND "certificate_badge_snapshots"."generation" >= 0),
	CONSTRAINT "certificate_badge_snapshots_dates_check" CHECK ("certificate_badge_snapshots"."periodStart" < "certificate_badge_snapshots"."periodEnd" AND "certificate_badge_snapshots"."periodEnd" = "certificate_badge_snapshots"."calculatedAt" AND "certificate_badge_snapshots"."expiresAt" > "certificate_badge_snapshots"."calculatedAt"),
	CONSTRAINT "certificate_badge_snapshots_qualifies_check" CHECK ("certificate_badge_snapshots"."qualifies" = ("certificate_badge_snapshots"."eligible" AND "certificate_badge_snapshots"."sampleCount" >= "certificate_badge_snapshots"."minimumPolicies" AND "certificate_badge_snapshots"."onTimeCount"::bigint * 10000 >= "certificate_badge_snapshots"."sampleCount"::bigint * "certificate_badge_snapshots"."thresholdBps"))
);
--> statement-breakpoint
CREATE TABLE "certificate_badge_states" (
	"insurerId" uuid PRIMARY KEY NOT NULL,
	"suspendedAt" timestamp (3) with time zone,
	"suspensionReason" varchar(2000),
	"generation" integer DEFAULT 0 NOT NULL,
	"updatedAt" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "certificate_badge_states_generation_check" CHECK ("certificate_badge_states"."generation" >= 0),
	CONSTRAINT "certificate_badge_states_suspension_check" CHECK (("certificate_badge_states"."suspendedAt" IS NULL AND "certificate_badge_states"."suspensionReason" IS NULL) OR ("certificate_badge_states"."suspendedAt" IS NOT NULL AND "certificate_badge_states"."suspensionReason" IS NOT NULL AND length(trim("certificate_badge_states"."suspensionReason")) BETWEEN 1 AND 2000))
);
--> statement-breakpoint
ALTER TABLE "certificate_badge_snapshots" ADD CONSTRAINT "certificate_badge_snapshots_insurer_fkey" FOREIGN KEY ("insurerId") REFERENCES "public"."insurers"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "certificate_badge_states" ADD CONSTRAINT "certificate_badge_states_insurer_fkey" FOREIGN KEY ("insurerId") REFERENCES "public"."insurers"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "certificate_badge_snapshots_daily_key" ON "certificate_badge_snapshots" USING btree ("insurerId","calculationDay","ruleVersion","generation");--> statement-breakpoint
CREATE INDEX "certificate_badge_snapshots_latest_idx" ON "certificate_badge_snapshots" USING btree ("insurerId","calculatedAt");
--> statement-breakpoint
-- Certificate badge invariants begin
CREATE FUNCTION public.certificate_badge_snapshots_reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Certificate badge snapshots are append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER certificate_badge_snapshots_append_only
BEFORE UPDATE OR DELETE ON public.certificate_badge_snapshots
FOR EACH ROW EXECUTE FUNCTION public.certificate_badge_snapshots_reject_mutation();
-- Certificate badge invariants end
