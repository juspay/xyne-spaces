-- AlterTable: Add isThreadActivity column to activities
-- This column indicates whether the activity is for a message inside a thread
-- (i.e., the message is NOT the initialMessageId of its conversation).
-- Used to distinguish thread-level activities from channel-level activities,
-- replacing the need for expensive whereExists joins in userUnreadThreadActivities query.
-- Backfill should be done separately via a backfill API in batches.

ALTER TABLE "activities" ADD COLUMN IF NOT EXISTS "isThreadActivity" BOOLEAN;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "activities_userId_isRead_isThreadActivity_idx" ON "activities"("userId", "isRead", "isThreadActivity");
