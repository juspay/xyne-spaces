-- Two composite indexes for Zero syncer source-fill statements (PR #1867).

-- Recency-ordered channel_stats reads (dmChannelsLatestMessagesPaginated and
-- friends) sort by (lastActivityAt desc, channelId desc) under a workspaceId
-- equality. Without a matching composite, every hydration degrades into a
-- full-table scan plus temp-sort before take(N) can emit a row.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "channel_stats_workspaceId_lastActivityAt_channelId_idx"
  ON "public"."channel_stats" ("workspaceId", "lastActivityAt" DESC, "channelId" DESC);

-- Zero's related-messages source fill reads a whole thread as
-- `WHERE "conversationId" = ? ORDER BY "messageId" asc`. No existing index
-- covers that order after the equality, so every fetch pays a temp B-tree
-- sort (~40% of the statement on a 3k-message thread). Both columns are
-- immutable, so the index sees inserts only.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "messages_conversationId_messageId_idx"
  ON "public"."messages" ("conversationId", "messageId");
