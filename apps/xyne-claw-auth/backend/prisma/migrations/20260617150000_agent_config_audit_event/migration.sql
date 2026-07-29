-- Add AGENT_CONFIG_UPDATED to the AgentAuditEvent enum so agent config/toolbox
-- edits (incl. non-HTTP "ghost" writers) get an audit trail. Postgres requires
-- ALTER TYPE ... ADD VALUE to run outside a transaction; Prisma runs each
-- migration file in its own transaction, so this single statement is fine.
ALTER TYPE "AgentAuditEvent" ADD VALUE IF NOT EXISTS 'AGENT_CONFIG_UPDATED';
