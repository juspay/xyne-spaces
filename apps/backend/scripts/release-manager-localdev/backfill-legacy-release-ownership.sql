-- One-time data fix after applying migration 20260610141753_release_management_v2
-- to a database with pre-existing applications/boards (prod). Run manually:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backfill-legacy-release-ownership.sql
--
-- Until this runs, pre-existing applications have NULL mainReleaseBoardId
-- (invisible to ownership queries) and main release boards have NULL
-- vcsProvider/releaseTrackingMode (the edit-config wizard rejects them).
--
-- Idempotent: only touches rows whose target columns are NULL. Runs in one
-- transaction — a constraint violation (e.g. duplicate app names in a project)
-- aborts the whole script; fix the data and rerun.

BEGIN;

-- A project's main release board is its only RELEASE board that no
-- application claims via boardId. Projects with zero or multiple candidates
-- are left untouched (verified in prod: exactly one per project).
WITH main_boards AS (
  SELECT b."projectId", MIN(b."id") AS board_id
  FROM "public"."boards" b
  WHERE b."boardType" = 'RELEASE'
    AND NOT EXISTS (
      SELECT 1 FROM "public"."applications" a WHERE a."boardId" = b."id"
    )
  GROUP BY b."projectId"
  HAVING COUNT(*) = 1
)
UPDATE "public"."applications" a
SET "mainReleaseBoardId" = mb.board_id
FROM main_boards mb
WHERE a."projectId" = mb."projectId"
  AND a."mainReleaseBoardId" IS NULL;

-- All teams use Bitbucket Server, and legacy boards predate VERSION mode.
UPDATE "public"."boards" b
SET "vcsProvider" = 'BITBUCKET_SERVER',
    "releaseTrackingMode" = COALESCE(b."releaseTrackingMode", 'COMMIT_RANGE')
WHERE b."vcsProvider" IS NULL
  AND EXISTS (
    SELECT 1 FROM "public"."applications" a WHERE a."mainReleaseBoardId" = b."id"
  );

COMMIT;
