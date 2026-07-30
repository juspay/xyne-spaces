-- Composite index for the Timeline query (releaseEventsByReleaseId): filter
-- releaseId, order by createdAt desc, id desc. Eliminates the zero-cache TEMP
-- B-TREE sort at scale. CONCURRENTLY so the build takes no write-blocking lock
-- on this pre-existing table.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "release_events_releaseId_createdAt_id_idx"
  ON "public"."release_events" ("releaseId", "createdAt" DESC, "id" DESC);
