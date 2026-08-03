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

-- CONCURRENTLY: no write-blocking lock on this pre-existing table (Prisma applies
-- migrations without a wrapping txn — see 20260421190000_add_performance_indices).
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "release_change_types_release_dedupe_key"
  ON "public"."release_change_types" ("releaseId", "applicationId", "changeType", "filePath", "commitId")
  WHERE "releaseId" IS NOT NULL AND "filePath" IS NOT NULL AND "commitId" IS NOT NULL;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "release_change_types_release_dedupe_nocommit_key"
  ON "public"."release_change_types" ("releaseId", "applicationId", "changeType", "filePath")
  WHERE "releaseId" IS NOT NULL AND "filePath" IS NOT NULL AND "commitId" IS NULL;
