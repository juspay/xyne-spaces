-- AlterTable: Add lastRecapHadMessages column to channel_stats
-- This field tracks whether the last daily recap had messages:

ALTER TABLE "channel_stats" ADD COLUMN IF NOT EXISTS "lastRecapHadMessages" BOOLEAN;