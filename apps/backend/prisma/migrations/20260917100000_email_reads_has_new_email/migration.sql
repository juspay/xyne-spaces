-- AlterTable
-- Nullable, no default: existing rows start NULL (not yet computed). Code writes
-- false on read and true when tickets.lastEmailAt moves past lastReadEmailAt;
-- POST /migrate/api/admin/email-read-flag-backfill (xyne-spaces-private) fills the
-- existing rows after deploy.
ALTER TABLE "public"."email_reads" ADD COLUMN "hasNewEmail" BOOLEAN;
