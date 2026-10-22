-- Audit events for Teams (XYNE-66905): a Teams sender linked to or unlinked
-- from a user, and a Microsoft tenant bound to or unbound from an org. Both
-- decide whose data a Teams message runs against, so every change needs a
-- durable trace.
--
-- Postgres requires ALTER TYPE ... ADD VALUE to run outside a transaction;
-- Prisma runs each migration file in its own transaction, so single
-- statements are fine (same pattern as 20261019120100_design_system_audit_events).
ALTER TYPE "AgentAuditEvent" ADD VALUE IF NOT EXISTS 'CHANNEL_IDENTITY_LINKED';
ALTER TYPE "AgentAuditEvent" ADD VALUE IF NOT EXISTS 'CHANNEL_IDENTITY_UNLINKED';
ALTER TYPE "AgentAuditEvent" ADD VALUE IF NOT EXISTS 'TEAMS_TENANT_BOUND';
ALTER TYPE "AgentAuditEvent" ADD VALUE IF NOT EXISTS 'TEAMS_TENANT_UNBOUND';
