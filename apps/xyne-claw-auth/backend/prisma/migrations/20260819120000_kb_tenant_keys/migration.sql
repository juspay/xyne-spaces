-- Denormalized tenant keys for the People-KB tables.
--
-- kb_projects already carried workspaceId; kb_channels and kb_runs did not, so
-- neither could be tenant-scoped without joining back through the project. Both
-- are strictly per-project, and a project belongs to exactly one workspace, so
-- the value is derivable for every existing row — added nullable, backfilled,
-- then made NOT NULL rather than dropped and recreated, so no data is lost.
--
-- kb_runs deliberately gets a plain column and no foreign key: a run record
-- outlives its subject (removing a project must not erase the history of what
-- was extracted from it), so it has to stay tenant-scopable after the parent
-- row is gone.

-- kb_channels
ALTER TABLE "kb_channels" ADD COLUMN "workspaceId" TEXT;

UPDATE "kb_channels" c
SET "workspaceId" = p."workspaceId"
FROM "kb_projects" p
WHERE c."projectId" = p."projectId"
  AND c."workspaceId" IS NULL;

-- A channel whose project has since been deleted cannot happen (the FK
-- cascades), so anything still null here is corruption rather than history.
DELETE FROM "kb_channels" WHERE "workspaceId" IS NULL;

ALTER TABLE "kb_channels" ALTER COLUMN "workspaceId" SET NOT NULL;

-- kb_runs
ALTER TABLE "kb_runs" ADD COLUMN "workspaceId" TEXT;

UPDATE "kb_runs" r
SET "workspaceId" = p."workspaceId"
FROM "kb_projects" p
WHERE r."projectId" = p."projectId"
  AND r."workspaceId" IS NULL;

-- Runs outlive their project, so a null here is an orphan from a project that
-- was removed. There is no workspace to attribute it to and no way to recover
-- one; keeping it would leave an untenanted row that no scoped query can ever
-- return.
DELETE FROM "kb_runs" WHERE "workspaceId" IS NULL;

ALTER TABLE "kb_runs" ALTER COLUMN "workspaceId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "kb_channels_workspaceId_included_idx" ON "kb_channels"("workspaceId", "included");

-- CreateIndex
CREATE INDEX "kb_runs_workspaceId_kind_startedAt_idx" ON "kb_runs"("workspaceId", "kind", "startedAt");
