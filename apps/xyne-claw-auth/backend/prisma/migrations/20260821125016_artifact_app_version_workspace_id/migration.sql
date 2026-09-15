-- Denormalized tenant key on artifact_app_versions.
-- Added nullable first, backfilled from the parent app, then made NOT NULL, so
-- existing rows survive the change.
ALTER TABLE "artifact_app_versions" ADD COLUMN "workspaceId" TEXT;

UPDATE "artifact_app_versions" v
SET "workspaceId" = a."workspaceId"
FROM "artifact_apps" a
WHERE a."id" = v."appId" AND v."workspaceId" IS NULL;

ALTER TABLE "artifact_app_versions" ALTER COLUMN "workspaceId" SET NOT NULL;

CREATE INDEX "artifact_app_versions_workspaceId_idx" ON "artifact_app_versions"("workspaceId");
