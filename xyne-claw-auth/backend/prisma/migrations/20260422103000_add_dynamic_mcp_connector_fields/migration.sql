-- Add DB-driven MCP connector definition fields
ALTER TABLE "mcp_servers"
  ADD COLUMN IF NOT EXISTS "enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "transport" TEXT NOT NULL DEFAULT 'stdio',
  ADD COLUMN IF NOT EXISTS "credentialSchema" JSONB,
  ADD COLUMN IF NOT EXISTS "credentialForm" JSONB,
  ADD COLUMN IF NOT EXISTS "launchConfigTemplate" JSONB,
  ADD COLUMN IF NOT EXISTS "httpConfigTemplate" JSONB,
  ADD COLUMN IF NOT EXISTS "healthcheckSpec" JSONB,
  ADD COLUMN IF NOT EXISTS "writeToolPolicy" JSONB,
  ADD COLUMN IF NOT EXISTS "connectorMeta" JSONB;

CREATE INDEX IF NOT EXISTS "mcp_servers_enabled_idx" ON "mcp_servers"("enabled");
CREATE INDEX IF NOT EXISTS "mcp_servers_transport_idx" ON "mcp_servers"("transport");
