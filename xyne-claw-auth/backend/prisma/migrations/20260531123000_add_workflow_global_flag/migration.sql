-- Add a `global` flag to chain workflows. Reserved for future use (semantics
-- TBD); defaults to false so existing workflows are unaffected.
ALTER TABLE "agent_chain_workflows"
    ADD COLUMN IF NOT EXISTS "global" BOOLEAN NOT NULL DEFAULT false;
