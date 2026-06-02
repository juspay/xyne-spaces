-- Allow multiple agent-level MCP credential rows per (agent, server type),
-- distinguished by a `slug` (e.g. "prod", "staging"). Each instance carries
-- its own `displayName` for the UI and its own encrypted creds for the
-- runner to inject when spawning that instance's MCP process.
--
-- Before this migration:
--   AgentMcpConnection unique on (agentId, mcpServerId) — at most one
--   Grafana per agent.
--
-- After:
--   AgentMcpConnection unique on (agentId, mcpServerId, slug) — any number
--   of Grafanas per agent, each with its own slug + display name. Existing
--   rows are backfilled with slug='default' so today's single-instance
--   semantics are preserved.

-- 1) Add the new columns. `slug` defaults to 'default' so all existing rows
--    get a valid value without the migration needing per-row writes.
ALTER TABLE "agent_mcp_connections"
    ADD COLUMN "slug"        TEXT NOT NULL DEFAULT 'default',
    ADD COLUMN "displayName" TEXT;

-- 2) Drop the single-instance unique constraint and replace it with one
--    that includes the slug. Prisma emits the constraint name as
--    "agent_mcp_connections_agentId_mcpServerId_key".
ALTER TABLE "agent_mcp_connections"
    DROP CONSTRAINT IF EXISTS "agent_mcp_connections_agentId_mcpServerId_key";

CREATE UNIQUE INDEX "agent_mcp_connections_agentId_mcpServerId_slug_key"
    ON "agent_mcp_connections" ("agentId", "mcpServerId", "slug");
