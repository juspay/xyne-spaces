-- DropIndex
DROP INDEX IF EXISTS "tickets_merchantId_idx";

-- DropIndex
DROP INDEX IF EXISTS "tickets_merchantId_createdAt_idx";

-- DropIndex
DROP INDEX IF EXISTS "tickets_channelId_merchantId_idx";

-- AlterTable
ALTER TABLE "tickets" DROP COLUMN "merchantId";
