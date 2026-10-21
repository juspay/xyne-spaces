-- A delegated run (A2A `call-agent`) is a real run spawned by another run
-- rather than by a person. These record that parentage so the runs panel can
-- tell the two apart. All nullable: a user-invoked run leaves them empty.
ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "parentSessionId" TEXT;
ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "parentAgentSlug" TEXT;
ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "parentToolCallId" TEXT;

CREATE INDEX IF NOT EXISTS "agent_runs_parentSessionId_idx" ON "agent_runs" ("parentSessionId");
