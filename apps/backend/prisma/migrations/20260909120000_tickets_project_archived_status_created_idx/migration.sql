CREATE INDEX CONCURRENTLY IF NOT EXISTS "tickets_projectId_isArchived_statusV2_createdAt_id_idx"
  ON "public"."tickets" ("projectId", "isArchived", "statusV2", "createdAt" DESC, "id");
