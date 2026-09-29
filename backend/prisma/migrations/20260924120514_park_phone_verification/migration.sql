-- AlterTable
ALTER TABLE "customers" DROP COLUMN "phoneVerifiedAt";

-- DropTable
DROP TABLE "otp_challenges";

-- DropEnum
DROP TYPE "OtpPurpose";
