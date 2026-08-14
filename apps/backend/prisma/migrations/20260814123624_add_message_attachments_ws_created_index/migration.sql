-- getConversationAttachementsV2 orders workspace-scoped attachments by
-- createdAt under Take(20); without this index every hydration full-scans
-- and sorts the table (60k rows scanned for 24 synced on the ART dataset;
-- 122s observed in prod). With it the common case walks ~100 rows.
-- Apply on prod with CREATE INDEX CONCURRENTLY before deploying.
CREATE INDEX IF NOT EXISTS "message_attachments_workspaceId_createdAt_id_idx"
  ON "message_attachments"("workspaceId", "createdAt" DESC, "id");
