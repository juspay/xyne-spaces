-- Audit events for messaging number links: who linked or unlinked which
-- number. A link decides whose data a WhatsApp message runs against, so
-- every change to one needs a durable trace.
--
-- Postgres requires ALTER TYPE ... ADD VALUE to run outside a transaction;
-- Prisma runs each migration file in its own transaction, so single
-- statements are fine (same pattern as 20261019120100_design_system_audit_events).
ALTER TYPE "AgentAuditEvent" ADD VALUE IF NOT EXISTS 'CHANNEL_NUMBER_LINKED';
ALTER TYPE "AgentAuditEvent" ADD VALUE IF NOT EXISTS 'CHANNEL_NUMBER_UNLINKED';
