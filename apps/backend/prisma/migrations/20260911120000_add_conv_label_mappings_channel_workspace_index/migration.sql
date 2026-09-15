CREATE INDEX CONCURRENTLY IF NOT EXISTS "conversation_label_mappings_channelId_workspaceId_idx" ON "public"."conversation_label_mappings"("channelId", "workspaceId");
