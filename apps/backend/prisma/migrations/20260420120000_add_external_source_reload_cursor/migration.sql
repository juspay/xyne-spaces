-- Add reload cursor to external_sources
-- Google stores the Gmail historyId string here.
-- Microsoft stores an ISO timestamp (last synced receivedDateTime).
ALTER TABLE "workflow"."external_sources"
  ADD COLUMN "lastSyncCursor" TEXT;

-- Index for channel-based lookup (used by the reload UI to find the source for a channel)
CREATE INDEX IF NOT EXISTS "external_sources_channelId_idx"
  ON "workflow"."external_sources" ("channelId");
