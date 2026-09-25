-- Add the AGENT_OWNERSHIP_TRANSFERRED audit event.
-- Additive enum value only: no table is rewritten and no existing row changes,
-- so this is safe to apply before the code that emits it (forward-compatible)
-- and harmless to leave in place on rollback (the value simply goes unused).
ALTER TYPE "AgentAuditEvent" ADD VALUE IF NOT EXISTS 'AGENT_OWNERSHIP_TRANSFERRED';
