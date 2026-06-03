-- Finalizes the `dashboards.workspaceId` column added in
-- 20260606000000_add_dynamic_dashboard_feature.
--
-- Run order required:
--   1. Deploy 20260606000000_add_dynamic_dashboard_feature (adds column with DEFAULT '').
--   2. Run POST /api/admin/dashboard-workspace-id-backfill in every environment.
--      Clashing dashboards are auto-renamed to "{name} ({creator.email})".
--   3. Deploy this migration.

-- Drop the temporary '' default so a missing workspaceId on insert fails
-- loudly with a NOT NULL violation instead of silently storing ''.
ALTER TABLE "public"."dashboards" ALTER COLUMN "workspaceId" DROP DEFAULT;

-- CreateIndex
CREATE UNIQUE INDEX "dashboards_workspaceId_name_key" ON "public"."dashboards"("workspaceId", "name");
