-- Add provider/model attribution to agent_runs so metrics can compare
-- provider+model latency without grepping logs.
ALTER TABLE "agent_runs"
ADD COLUMN "provider" TEXT,
ADD COLUMN "model" TEXT;

CREATE INDEX "agent_runs_provider_completedAt_idx"
ON "agent_runs"("provider", "completedAt");
