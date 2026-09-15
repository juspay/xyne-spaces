-- Audit events for the agent-authoring tools (create/update-subagent,
-- create-mcp). Agent + skill authoring already have their own events;
-- subagents and agent-proposed MCP servers did not, so those writes would
-- otherwise land with no actor recorded — the one thing an approval-gated
-- write must never lose.
--
-- Postgres requires ALTER TYPE ... ADD VALUE to run outside a transaction;
-- Prisma runs each migration file in its own transaction, so single
-- statements are fine (same pattern as 20260709120000_agent_updated_event).
ALTER TYPE "AgentAuditEvent" ADD VALUE IF NOT EXISTS 'SUBAGENT_CREATED';
ALTER TYPE "AgentAuditEvent" ADD VALUE IF NOT EXISTS 'SUBAGENT_UPDATED';
ALTER TYPE "AgentAuditEvent" ADD VALUE IF NOT EXISTS 'MCP_SERVER_CREATED';
