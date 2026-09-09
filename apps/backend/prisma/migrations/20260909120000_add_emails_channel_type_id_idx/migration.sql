-- CreateIndex
-- Desk auto-label backfill walks one channel's inbound mail by keyset, within a
-- lookback window:
--   WHERE "channelId" = $1 AND "type" = 'DEFAULT' AND "createdAt" >= $2
--     AND "id" > $cursor ORDER BY "id" ASC
-- "emails_channelId_idx" alone forces a filter+sort over every email in the channel.
-- "createdAt" trails "id": "id" is the column the scan ranges on AND orders by, so
-- it has to come first for the LIMIT to stop early without a sort. "createdAt" is
-- only ever an extra filter, and keeping it in the index lets both the count and
-- the pre-window rows be tested without a heap fetch per row.
-- CONCURRENTLY: emails is on the inbound mail write path.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "emails_channelId_type_id_createdAt_idx"
  ON "public"."emails" ("channelId", "type", "id", "createdAt");
