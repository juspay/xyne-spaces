-- CreateTable
CREATE TABLE IF NOT EXISTS "design_system_versions" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "designSystemId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "designMd" TEXT NOT NULL,
    "tokensCss" TEXT NOT NULL,
    "assets" JSONB,
    "changeSummary" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "design_system_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "design_system_versions_orgId_designSystemId_idx" ON "design_system_versions"("orgId", "designSystemId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "design_system_versions_designSystemId_version_key" ON "design_system_versions"("designSystemId", "version");

-- AddForeignKey
-- Postgres has no ADD CONSTRAINT IF NOT EXISTS, and this file is written to be
-- re-runnable, so the guard is explicit.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'design_system_versions_designSystemId_fkey'
  ) THEN
    ALTER TABLE "design_system_versions"
      ADD CONSTRAINT "design_system_versions_designSystemId_fkey"
      FOREIGN KEY ("designSystemId") REFERENCES "design_systems"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Backfill: one snapshot per existing system, at the version it is already on.
--
-- Systems created before this table exists would otherwise have an empty
-- history and would 404 on a read of their own current version. Every version
-- from 1 to design_systems.version is meant to be present here; for a system
-- edited before today only the current content survives, so that is the one row
-- that can honestly be written.
--
-- The id is derived from (system, version) rather than random, so re-running
-- this file cannot produce a second row for the same snapshot even without the
-- conflict clause. createdAt is the parent's updatedAt, because that is when
-- this content became current — not when the migration ran.
INSERT INTO "design_system_versions" (
    "id", "orgId", "designSystemId", "version",
    "designMd", "tokensCss", "assets", "changeSummary",
    "createdBy", "createdAt"
)
SELECT
    'dsv-' || "id" || '-v' || "version",
    "orgId",
    "id",
    "version",
    "designMd",
    "tokensCss",
    "assets",
    'Recorded when version history was added; earlier revisions were not kept',
    "createdBy",
    "updatedAt"
FROM "design_systems"
ON CONFLICT ("designSystemId", "version") DO NOTHING;
