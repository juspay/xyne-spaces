-- Org-scoped global MCP credentials (2026-07-14).
-- orgId=NULL keeps the legacy deployment-wide default row; an orgId row
-- overrides the default for that org. Existing rows become the default
-- (orgId NULL) with no behavior change.

-- AlterTable
ALTER TABLE "global_mcp_credentials" ADD COLUMN "orgId" TEXT;

-- DropIndex (old 1-row-per-server uniqueness)
DROP INDEX "global_mcp_credentials_mcpServerId_key";

-- CreateIndex: composite uniqueness for org-scoped rows
CREATE UNIQUE INDEX "global_mcp_credentials_mcpServerId_orgId_key"
  ON "global_mcp_credentials"("mcpServerId", "orgId");

-- CreateIndex: partial unique — at most ONE default (NULL-org) row per server.
-- Postgres treats NULLs as distinct in the composite unique above, so without
-- this two default rows could coexist and the loader's pick becomes arbitrary.
CREATE UNIQUE INDEX "global_mcp_credentials_mcpServerId_default_key"
  ON "global_mcp_credentials"("mcpServerId") WHERE "orgId" IS NULL;

-- CreateIndex: lookup by server
CREATE INDEX "global_mcp_credentials_mcpServerId_idx"
  ON "global_mcp_credentials"("mcpServerId");
