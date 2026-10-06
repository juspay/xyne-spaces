-- Add organization-scope columns and tables in a backfill-safe state.

ALTER TABLE "mcp_servers" ADD COLUMN "orgId" TEXT;
ALTER TABLE "mcp_servers" DROP CONSTRAINT IF EXISTS "mcp_servers_type_key";
CREATE INDEX "mcp_servers_orgId_type_idx" ON "mcp_servers"("orgId", "type");

ALTER TABLE "mcp_connector_edit_requests" ADD COLUMN "orgId" TEXT;
CREATE INDEX "mcp_connector_edit_requests_orgId_status_createdAt_idx"
  ON "mcp_connector_edit_requests"("orgId", "status", "createdAt");

ALTER TABLE "error_buckets" DROP CONSTRAINT IF EXISTS "error_buckets_name_key";
ALTER TABLE "error_buckets" ADD COLUMN "orgId" TEXT;
