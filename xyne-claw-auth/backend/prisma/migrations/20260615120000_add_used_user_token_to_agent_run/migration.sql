-- Admin "All Runs" ACL: mark runs that used a user-scoped credential.
ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "usedUserToken" BOOLEAN NOT NULL DEFAULT false;
