-- CreateEnum
CREATE TYPE "public"."AutoDraftMode" AS ENUM ('OFF', 'DRAFT');

-- AlterTable
ALTER TABLE "public"."email_channel_preferences" ADD COLUMN     "autoDraftMode" "public"."AutoDraftMode" NOT NULL DEFAULT 'OFF';

