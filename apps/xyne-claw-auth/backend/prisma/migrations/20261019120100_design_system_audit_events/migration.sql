-- Audit events for org-level design systems. The agent-scoped
-- `PATCH /agents/:slug/design-system` already records AGENT_UPDATED; a
-- DesignSystem row is org-owned and outlives any one agent, so its writes need
-- their own events rather than being filed under the agent that happened to
-- point at it.
--
-- Postgres requires ALTER TYPE ... ADD VALUE to run outside a transaction;
-- Prisma runs each migration file in its own transaction, so single
-- statements are fine (same pattern as 20260818090000_agent_authoring_audit_events).
ALTER TYPE "AgentAuditEvent" ADD VALUE IF NOT EXISTS 'DESIGN_SYSTEM_CREATED';
ALTER TYPE "AgentAuditEvent" ADD VALUE IF NOT EXISTS 'DESIGN_SYSTEM_UPDATED';
ALTER TYPE "AgentAuditEvent" ADD VALUE IF NOT EXISTS 'DESIGN_SYSTEM_DELETED';
