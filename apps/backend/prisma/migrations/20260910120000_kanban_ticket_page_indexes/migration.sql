-- Kanban board columns filter on an equality prefix and sort by (createdAt desc, id).
-- Without a composite covering both, the ordered read degrades into a full sort of the
-- candidate set. Two shapes: the first serves columns with no creator filter, the second
-- serves creator-filtered views.

CREATE INDEX CONCURRENTLY IF NOT EXISTS "tickets_workspaceId_statusV2_isArchived_rootId_createdAt_id_idx"
  ON "public"."tickets" ("workspaceId", "statusV2", "isArchived", "rootId", "createdAt" DESC, "id");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "tickets_workspaceId_createdBy_statusV2_isArchived_createdAt_idx"
  ON "public"."tickets" ("workspaceId", "createdBy", "statusV2", "isArchived", "createdAt" DESC, "id");
