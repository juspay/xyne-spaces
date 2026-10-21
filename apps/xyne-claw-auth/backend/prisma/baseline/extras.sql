DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agents_delegationTier_check') THEN
    ALTER TABLE "agents"
      ADD CONSTRAINT "agents_delegationTier_check"
      CHECK ("delegationTier" IN ('standard', 'orchestrator'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_delegation_grants_status_check') THEN
    ALTER TABLE "agent_delegation_grants"
      ADD CONSTRAINT "agent_delegation_grants_status_check"
      CHECK ("status" IN ('pending', 'approved', 'rejected'));
  END IF;
END
$$;
