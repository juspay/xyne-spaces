-- Audit events for model price changes in the AI control panel's settings.
ALTER TYPE "AgentAuditEvent" ADD VALUE IF NOT EXISTS 'LLM_PRICE_CREATED';
ALTER TYPE "AgentAuditEvent" ADD VALUE IF NOT EXISTS 'LLM_PRICE_UPDATED';
ALTER TYPE "AgentAuditEvent" ADD VALUE IF NOT EXISTS 'LLM_PRICE_DELETED';
