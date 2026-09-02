-- Desk auto-label backfill walks one channel's inbound mail by keyset:
--   WHERE "channelId" = $1 AND "type" = 'DEFAULT' AND "id" > $cursor ORDER BY "id" ASC
-- The existing "emails_channelId_idx" forces a filter+sort over every email in the
-- channel; this composite serves the predicate and the ordering together.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "emails_channelId_type_id_idx" ON "public"."emails" ("channelId", "type", "id");
