-- Follow-up to 20260519010000_agent_mcp_multi_instance.
--
-- That migration tried to drop the pre-multi-instance unique with
-- `DROP CONSTRAINT IF EXISTS "agent_mcp_connections_agentId_mcpServerId_key"`,
-- but Prisma emits `@@unique([...])` as a plain UNIQUE INDEX rather than a
-- table CONSTRAINT in Postgres — so the IF EXISTS clause silently no-op'd
-- and both indexes survived. The result was a P2002 unique-violation on
-- (agentId, mcpServerId) whenever a user tried to add a SECOND instance of
-- any MCP type to the same agent.
--
-- This migration drops the legacy index by name. `IF EXISTS` so re-running
-- on a fresh database (where 20260519010000 already cleaned up) is a no-op.

DROP INDEX IF EXISTS "agent_mcp_connections_agentId_mcpServerId_key";
