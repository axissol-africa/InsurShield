-- Accounts move from Keycloak into this database.
--
-- Existing rows have no password to carry over, so they are given an empty
-- hash. `verifyPassword` rejects an empty hash outright, so those accounts
-- cannot be signed into until someone sets a password — a closed door rather
-- than an open one. The seed re-provisions the demo accounts.

-- DropIndex
DROP INDEX "customers_keycloakId_key";

-- DropIndex
DROP INDEX "staff_users_keycloakId_key";

-- AlterTable
ALTER TABLE "customers" DROP COLUMN "keycloakId",
ADD COLUMN     "lastLoginAt" TIMESTAMP(3),
ADD COLUMN     "passwordHash" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "suspendedAt" TIMESTAMP(3);
ALTER TABLE "customers" ALTER COLUMN "passwordHash" DROP DEFAULT;

-- AlterTable
ALTER TABLE "staff_users" DROP COLUMN "keycloakId",
ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "passwordHash" TEXT NOT NULL DEFAULT '';
ALTER TABLE "staff_users" ALTER COLUMN "passwordHash" DROP DEFAULT;
