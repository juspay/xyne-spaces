-- Add admin-controlled agent delegation tier.
--
-- Orchestrator-tier agents may delegate to enabled global agents in their org
-- without pair grants; personal/shared agents still require approved
-- agent_delegation_grants rows. Guarded for local/dev databases where this was
-- applied manually during feature rollout.

ALTER TABLE "agents"
  ADD COLUMN IF NOT EXISTS "delegationTier" TEXT NOT NULL DEFAULT 'standard';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'agents_delegationTier_check'
  ) THEN
    ALTER TABLE "agents"
      ADD CONSTRAINT "agents_delegationTier_check"
      CHECK ("delegationTier" IN ('standard', 'orchestrator'));
  END IF;
END
$$;
