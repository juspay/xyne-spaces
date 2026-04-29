-- CreateEnum
CREATE TYPE "public"."ChannelSortOrder" AS ENUM ('UNREAD', 'RECENCY', 'ALPHABETICAL');

-- AlterTable
ALTER TABLE "public"."user_preferences" ADD COLUMN     "channelSortOrder" "public"."ChannelSortOrder" NOT NULL DEFAULT 'RECENCY';
