-- Insurer administrators need a real, organisation-bound staff directory.
--
-- A team is deliberately small at this stage: one insurer owns it and a staff
-- member may join one team. Roles remain the authority for permissions; the
-- team is the durable assignment boundary that later queue work can use.
CREATE TABLE "staff_teams" (
	"id" uuid PRIMARY KEY NOT NULL,
	"insurerId" uuid NOT NULL,
	"name" text NOT NULL,
	"createdAt" timestamp (3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "staff_users" ADD COLUMN "teamId" uuid;--> statement-breakpoint
ALTER TABLE "staff_teams" ADD CONSTRAINT "staff_teams_insurerId_fkey" FOREIGN KEY ("insurerId") REFERENCES "public"."insurers"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "staff_users" ADD CONSTRAINT "staff_users_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "public"."staff_teams"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "staff_teams_insurerId_idx" ON "staff_teams" USING btree ("insurerId");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_teams_insurerId_name_key" ON "staff_teams" USING btree ("insurerId", "name");--> statement-breakpoint
CREATE INDEX "staff_users_teamId_idx" ON "staff_users" USING btree ("teamId");
