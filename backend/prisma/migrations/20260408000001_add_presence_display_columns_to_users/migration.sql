-- AlterTable: Promote presence display + notification + assignment columns from user_presence to users table.
-- These fields are dual-written from user_presence for query performance,
-- eliminating the need for a related query when loading all users via getUsersV2.
-- The user_presence copies are deprecated but kept for backward compatibility.
-- Run after deploy: POST /api/admin/user-migration/backfill-presence-status

ALTER TABLE "public"."users"
  ADD COLUMN IF NOT EXISTS "statusEmoji" TEXT,
  ADD COLUMN IF NOT EXISTS "statusContent" TEXT,
  ADD COLUMN IF NOT EXISTS "statusExpiryAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastActiveAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "notificationsPausedUntil" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "assignmentUnavailableUntil" TIMESTAMP(3);
