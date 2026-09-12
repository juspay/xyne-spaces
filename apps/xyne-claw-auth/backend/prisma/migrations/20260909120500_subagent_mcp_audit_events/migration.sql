-- Audit events for subagent-level MCP credential writes. Kept in a SEPARATE
-- migration from the table create so the ALTER TYPE ... ADD VALUE runs in its
-- own transaction (Postgres forbids using a freshly-added enum value in the
-- same transaction that adds it). Same pattern as
-- 20260818090000_agent_authoring_audit_events.
ALTER TYPE "AgentAuditEvent" ADD VALUE IF NOT EXISTS 'SUBAGENT_MCP_UPDATED';
ALTER TYPE "AgentAuditEvent" ADD VALUE IF NOT EXISTS 'SUBAGENT_MCP_DELETED';
