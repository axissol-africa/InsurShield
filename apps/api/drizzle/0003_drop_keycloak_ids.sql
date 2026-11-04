DROP INDEX "customers_keycloakId_key";--> statement-breakpoint
DROP INDEX "staff_users_keycloakId_key";--> statement-breakpoint
ALTER TABLE "customers" DROP COLUMN "keycloakId";--> statement-breakpoint
ALTER TABLE "staff_users" DROP COLUMN "keycloakId";