-- Release Manager v3 schema changes (consolidated). Three concerns:
--   1. isHotfix flag on application_release_tickets
--   2. Partial-unique dedupe indexes on release_change_types
--   3. Timeline composite index on release_events

-- ── 1. Hotfix flag ──────────────────────────────────────────────────────────
-- Nullable, no DB default: Zero's optimistic client inserts don't run Postgres
-- defaults, so isHotfix is written app-side; NULL reads as "not a hotfix".
ALTER TABLE "public"."application_release_tickets" ADD COLUMN "isHotfix" BOOLEAN;

-- ── 2. ReleaseChangeType dedupe ─────────────────────────────────────────────
-- Partial unique indexes making ReleaseChangeType dedupe race-safe. Two indexes
-- because a unique index treats NULLs as distinct: one keys on commitId (so two
-- different commits touching the same file keep separate rows), one covers the
-- commitId IS NULL rows. Partial on releaseId/filePath NOT NULL so legacy pre-v2
-- rows (NULL releaseId) stay un-deduped.

-- Dedupe existing rows first so the unique builds can't fail: keep the oldest per
-- group (createdAt, id; COALESCE for nullable createdAt). Index-supported via
-- release_change_types_releaseId_idx and scoped to non-NULL releaseId. Off-peak.
DELETE FROM "public"."release_change_types" t
USING "public"."release_change_types" keep
WHERE t."releaseId" IS NOT NULL
  AND t."filePath" IS NOT NULL
  AND keep."releaseId" = t."releaseId"
  AND keep."applicationId" = t."applicationId"
  AND keep."changeType" = t."changeType"
  AND keep."filePath" = t."filePath"
  AND keep."commitId" IS NOT DISTINCT FROM t."commitId"
  AND (COALESCE(keep."createdAt", 'epoch'::timestamptz), keep."id")
    < (COALESCE(t."createdAt", 'epoch'::timestamptz), t."id");

-- Zero-safe: Zero only mirrors FULL indexes into its client SQLite — it filters
-- out PARTIAL indexes by design (its published-schema step requires pg_index.indpred
-- IS NULL). Both indexes below are partial (WHERE ...), so Zero never sees them and
-- sync can't break; they exist purely for Postgres-side dedupe enforcement.
-- CONCURRENTLY: no write-blocking lock on this pre-existing table (Prisma applies
-- migrations without a wrapping txn — see 20260421190000_add_performance_indices).
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "release_change_types_release_dedupe_key"
  ON "public"."release_change_types" ("releaseId", "applicationId", "changeType", "filePath", "commitId")
  WHERE "releaseId" IS NOT NULL AND "filePath" IS NOT NULL AND "commitId" IS NOT NULL;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "release_change_types_release_dedupe_nocommit_key"
  ON "public"."release_change_types" ("releaseId", "applicationId", "changeType", "filePath")
  WHERE "releaseId" IS NOT NULL AND "filePath" IS NOT NULL AND "commitId" IS NULL;

-- ── 3. Timeline index ───────────────────────────────────────────────────────
-- Composite index for the Timeline query (releaseEventsByReleaseId): filter
-- releaseId, order by createdAt desc, id desc. Eliminates the zero-cache TEMP
-- B-TREE sort at scale. CONCURRENTLY so the build takes no write-blocking lock
-- on this pre-existing table.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "release_events_releaseId_createdAt_id_idx"
  ON "public"."release_events" ("releaseId", "createdAt" DESC, "id" DESC);
