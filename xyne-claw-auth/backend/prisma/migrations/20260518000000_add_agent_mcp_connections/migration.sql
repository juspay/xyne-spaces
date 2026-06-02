-- Agent-scoped MCP credentials. Lets the agent owner pin a specific MCP
-- instance to an agent (e.g. hyperswitch-agent → Hyperswitch Grafana,
-- xyne-agent → Xyne Grafana). The credentials resolver checks this table
-- BEFORE UserMcpConnection so the agent's identity wins on conflict.
--
-- Same encryption envelope as user_mcp_connections (AES-GCM via lib/crypto).
-- Cascades on both Agent and McpServer deletion so orphaned encrypted
-- payloads can't linger.

CREATE TABLE "agent_mcp_connections" (
  "id"              TEXT PRIMARY KEY,
  "agentId"         TEXT NOT NULL,
  "mcpServerId"     TEXT NOT NULL,
  "encryptedCreds"  TEXT NOT NULL,
  "iv"              TEXT NOT NULL,
  "authTag"         TEXT NOT NULL,
  "createdByUserId" TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  CONSTRAINT "agent_mcp_connections_agentId_fkey"
    FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE,
  CONSTRAINT "agent_mcp_connections_mcpServerId_fkey"
    FOREIGN KEY ("mcpServerId") REFERENCES "mcp_servers"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "agent_mcp_connections_agentId_mcpServerId_key"
  ON "agent_mcp_connections" ("agentId", "mcpServerId");

CREATE INDEX "agent_mcp_connections_agentId_idx"
  ON "agent_mcp_connections" ("agentId");
