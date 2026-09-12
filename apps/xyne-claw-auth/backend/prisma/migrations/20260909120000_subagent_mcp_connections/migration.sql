-- Per-subagent MCP credentials. Companion to agent_mcp_connections, but owned
-- by a subagent_definitions row. Resolves ABOVE the agent/user/global cascade
-- in credentials-loader; when non_overridable is true it short-circuits the
-- cascade entirely so no lower-priority credential can shadow it.
--
-- Additive only: absence of a row == today's behaviour (subagent inherits the
-- parent agent's pinned instance via mcpInstanceMap). No backfill needed.
CREATE TABLE "subagent_mcp_connections" (
    "id" TEXT NOT NULL,
    "subagentDefinitionId" TEXT NOT NULL,
    "mcpServerId" TEXT NOT NULL,
    "slug" TEXT NOT NULL DEFAULT 'default',
    "displayName" TEXT,
    "nonOverridable" BOOLEAN NOT NULL DEFAULT true,
    "encryptedCreds" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subagent_mcp_connections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "subagent_mcp_connections_subagentDefinitionId_mcpServerId_slug_key"
    ON "subagent_mcp_connections"("subagentDefinitionId", "mcpServerId", "slug");

CREATE INDEX "subagent_mcp_connections_subagentDefinitionId_idx"
    ON "subagent_mcp_connections"("subagentDefinitionId");

ALTER TABLE "subagent_mcp_connections"
    ADD CONSTRAINT "subagent_mcp_connections_subagentDefinitionId_fkey"
    FOREIGN KEY ("subagentDefinitionId") REFERENCES "subagent_definitions"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "subagent_mcp_connections"
    ADD CONSTRAINT "subagent_mcp_connections_mcpServerId_fkey"
    FOREIGN KEY ("mcpServerId") REFERENCES "mcp_servers"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
