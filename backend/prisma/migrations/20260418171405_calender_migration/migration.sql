-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "public"."CallOrigin" ADD VALUE 'GOOGLE_CALENDAR';
ALTER TYPE "public"."CallOrigin" ADD VALUE 'MICROSOFT_CALENDAR';

-- AlterTable
ALTER TABLE "public"."calls" ALTER COLUMN "channelId" DROP NOT NULL;
