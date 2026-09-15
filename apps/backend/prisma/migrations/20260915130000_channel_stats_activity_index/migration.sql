-- Recency-ordered channel_stats reads (dmChannelsLatestMessagesPaginated and
-- friends) sort by (lastActivityAt desc, channelId desc) under a workspaceId
-- equality. Without a matching composite, every hydration degrades into a
-- full-table scan plus temp-sort before take(N) can emit a row.

CREATE INDEX CONCURRENTLY IF NOT EXISTS "channel_stats_workspaceId_lastActivityAt_channelId_idx"
  ON "public"."channel_stats" ("workspaceId", "lastActivityAt" DESC, "channelId" DESC);
