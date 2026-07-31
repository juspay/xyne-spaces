-- DropIndex
DROP INDEX IF EXISTS "workflow"."external_sources_workspaceId_sourceType_key";

-- CreateIndex
CREATE INDEX IF NOT EXISTS "external_sources_workspaceId_sourceType_idx" ON "workflow"."external_sources"("workspaceId", "sourceType");
