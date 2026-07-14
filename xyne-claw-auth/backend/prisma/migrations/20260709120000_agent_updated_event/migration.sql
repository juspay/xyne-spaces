-- Add AGENT_UPDATED to the AgentAuditEvent enum so general agent edits
-- (name/description/prompt/model/enabled/slug/color) get an audit trail.
-- Tools-only edits continue to use AGENT_CONFIG_UPDATED. Postgres requires
-- ALTER TYPE ... ADD VALUE to run outside a transaction; Prisma runs each
-- migration file in its own transaction, so this single statement is fine.
ALTER TYPE "AgentAuditEvent" ADD VALUE IF NOT EXISTS 'AGENT_UPDATED';
