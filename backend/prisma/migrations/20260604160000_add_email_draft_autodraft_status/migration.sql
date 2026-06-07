-- CreateEnum
CREATE TYPE "public"."AutoDraftStatus" AS ENUM ('GENERATING', 'READY');

-- AlterTable
ALTER TABLE "public"."email_drafts" ADD COLUMN "autoDraftStatus" "public"."AutoDraftStatus";
