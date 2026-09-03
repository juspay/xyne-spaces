-- CreateIndex
CREATE INDEX CONCURRENTLY IF NOT EXISTS "recaps_entityType_recapDate_entityId_idx"
  ON "public"."recaps" ("entityType", "recapDate", "entityId");
