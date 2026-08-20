-- Basenames of proof files the agent delivered to the thread. Gates the
-- `proved` status: proof that never left the sandbox dies with the sandbox.
ALTER TABLE "experiment_runs"
  ADD COLUMN "deliveredArtifacts" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
