CREATE INDEX CONCURRENTLY IF NOT EXISTS "forms_context_mapping_formId_idx" ON "forms_context_mapping"("formId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "message_attachments_workspaceId_createdAt_id_idx"
  ON "message_attachments"("workspaceId", "createdAt" DESC, "id");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "channel_stats_workspaceId_lastActivityAt_channelId_idx"
  ON "channel_stats"("workspaceId", "lastActivityAt" DESC, "channelId" DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "message_attachments_entityId_entityType_createdAt_idx"
  ON "message_attachments"("entityId", "entityType", "createdAt" DESC);
