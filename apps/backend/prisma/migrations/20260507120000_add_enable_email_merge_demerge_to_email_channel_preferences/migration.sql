-- CreateEnum
CREATE TYPE "public"."EmailMergeMode" AS ENUM ('DISABLED', 'ENABLED');

-- AlterTable
ALTER TABLE "public"."email_channel_preferences"
ADD COLUMN "emailMergeMode" "public"."EmailMergeMode" NOT NULL DEFAULT 'ENABLED';
