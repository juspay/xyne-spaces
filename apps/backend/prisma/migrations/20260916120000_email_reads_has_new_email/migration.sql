-- AlterTable
-- Existing rows start as false; POST /api/admin/email-read-flag-backfill/run sets
-- them from lastReadEmailAt < tickets.lastEmailAt after deploy.
ALTER TABLE "public"."email_reads" ADD COLUMN "hasNewEmail" BOOLEAN NOT NULL DEFAULT false;
