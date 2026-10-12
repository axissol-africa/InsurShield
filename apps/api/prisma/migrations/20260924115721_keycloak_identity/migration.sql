-- AlterTable
ALTER TABLE "customers" DROP COLUMN "passwordHash",
ADD COLUMN     "keycloakId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "staff_users" DROP COLUMN "passwordHash",
ADD COLUMN     "keycloakId" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "customers_keycloakId_key" ON "customers"("keycloakId");

-- CreateIndex
CREATE UNIQUE INDEX "staff_users_keycloakId_key" ON "staff_users"("keycloakId");
