-- CreateIndex
-- Radar keys a DM on its channel, so channelId now drives four queries that
-- previously only ever ran by conversation: the DM open-item lookup on every
-- parse, the debug drawer, and both bulk manual actions. execution_items keeps
-- resolved rows, so it only grows.
-- CONCURRENTLY: the table is read on the message write path via the parse queue.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "execution_items_channelId_status_idx"
  ON "non_zero"."execution_items" ("channelId", "status");
