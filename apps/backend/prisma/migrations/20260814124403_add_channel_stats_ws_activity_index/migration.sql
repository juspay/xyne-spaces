-- dmChannelsLatestMessagesPaginated pages channel_stats by lastActivityAt
-- under Take(20); channel_stats only had an index on channelId, so every
-- hydration full-scanned and sorted the table (20k rows scanned for 43
-- synced on the ART dataset). With the index the ordered walk stops at
-- the take (289 rows scanned).
-- Apply on prod with CREATE INDEX CONCURRENTLY before deploying.
CREATE INDEX IF NOT EXISTS "channel_stats_workspaceId_lastActivityAt_channelId_idx"
  ON "channel_stats"("workspaceId", "lastActivityAt" DESC, "channelId" DESC);
