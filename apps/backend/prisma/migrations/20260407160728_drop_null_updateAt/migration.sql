-- AlterTable
ALTER TABLE "public"."bookmarks"
ALTER COLUMN "updatedAt" DROP NOT NULL;
-- AlterTable
ALTER TABLE "public"."channel_user_status" 
ALTER COLUMN "updatedAt" DROP NOT NULL;