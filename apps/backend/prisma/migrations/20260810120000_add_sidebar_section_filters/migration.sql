-- AlterTable
ALTER TABLE "public"."channel_sections" ADD COLUMN "filterMode" TEXT;

-- AlterTable
ALTER TABLE "public"."user_preferences" ADD COLUMN "channelFilterMode" TEXT;
ALTER TABLE "public"."user_preferences" ADD COLUMN "starredFilterMode" TEXT;
ALTER TABLE "public"."user_preferences" ADD COLUMN "starredSortOrder" TEXT;
ALTER TABLE "public"."user_preferences" ADD COLUMN "dmFilterMode" TEXT;
ALTER TABLE "public"."user_preferences" ADD COLUMN "dmSortOrder" TEXT;
