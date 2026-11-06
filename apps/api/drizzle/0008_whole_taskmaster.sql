CREATE TABLE "pia_config_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"piaRateBps" integer NOT NULL,
	"previousRateBps" integer,
	"changedByStaffId" uuid,
	"note" text,
	"changedAt" timestamp (3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "pia_config_history_piaRateBps_check" CHECK ("pia_config_history"."piaRateBps" >= 0 AND "pia_config_history"."piaRateBps" <= 10000),
	CONSTRAINT "pia_config_history_previousRateBps_check" CHECK ("pia_config_history"."previousRateBps" IS NULL OR ("pia_config_history"."previousRateBps" >= 0 AND "pia_config_history"."previousRateBps" <= 10000))
);
--> statement-breakpoint
CREATE TABLE "state_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entityType" text NOT NULL,
	"entityId" text NOT NULL,
	"fromStatus" text,
	"toStatus" text NOT NULL,
	"actorType" "ActorType" NOT NULL,
	"actorId" text,
	"note" text,
	"correlationId" text,
	"createdAt" timestamp (3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "correlationId" text;--> statement-breakpoint
ALTER TABLE "pia_config_history" ADD CONSTRAINT "pia_config_history_changedByStaffId_fkey" FOREIGN KEY ("changedByStaffId") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "pia_config_history_changedAt_idx" ON "pia_config_history" USING btree ("changedAt");--> statement-breakpoint
CREATE INDEX "state_history_entityType_entityId_createdAt_idx" ON "state_history" USING btree ("entityType","entityId","createdAt");--> statement-breakpoint
CREATE INDEX "state_history_actorType_actorId_createdAt_idx" ON "state_history" USING btree ("actorType","actorId","createdAt");--> statement-breakpoint
CREATE INDEX "audit_logs_createdAt_id_idx" ON "audit_logs" USING btree ("createdAt","id");--> statement-breakpoint
CREATE INDEX "audit_logs_action_createdAt_idx" ON "audit_logs" USING btree ("action","createdAt");--> statement-breakpoint
-- Audit events are evidence. Application roles may append them but cannot edit
-- or remove them, even if a future repository accidentally exposes a write.
REVOKE UPDATE, DELETE ON TABLE "audit_logs" FROM PUBLIC;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "audit_logs_reject_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "audit_logs_append_only"
BEFORE UPDATE OR DELETE ON "audit_logs"
FOR EACH ROW
EXECUTE FUNCTION "audit_logs_reject_mutation"();
