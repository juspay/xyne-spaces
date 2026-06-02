-- Add allow-global-fallback flag to mcp_servers (off by default)
ALTER TABLE "mcp_servers" ADD COLUMN "allowGlobalFallback" BOOLEAN NOT NULL DEFAULT false;

-- New audit event types for global-fallback admin actions
ALTER TYPE "AgentAuditEvent" ADD VALUE 'MCP_GLOBAL_FALLBACK_ENABLED';
ALTER TYPE "AgentAuditEvent" ADD VALUE 'MCP_GLOBAL_FALLBACK_DISABLED';
ALTER TYPE "AgentAuditEvent" ADD VALUE 'MCP_GLOBAL_CREDENTIALS_SET';
ALTER TYPE "AgentAuditEvent" ADD VALUE 'MCP_GLOBAL_CREDENTIALS_REMOVED';

-- Admin-managed global credentials per MCP server
CREATE TABLE "global_mcp_credentials" (
  "id"             TEXT NOT NULL,
  "mcpServerId"    TEXT NOT NULL,
  "encryptedCreds" TEXT NOT NULL,
  "iv"             TEXT NOT NULL,
  "authTag"        TEXT NOT NULL,
  "setByUserId"    TEXT NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "global_mcp_credentials_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "global_mcp_credentials_mcpServerId_key" ON "global_mcp_credentials"("mcpServerId");

ALTER TABLE "global_mcp_credentials"
  ADD CONSTRAINT "global_mcp_credentials_mcpServerId_fkey"
  FOREIGN KEY ("mcpServerId") REFERENCES "mcp_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
