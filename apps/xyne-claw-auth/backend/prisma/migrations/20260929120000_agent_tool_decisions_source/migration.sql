-- Record which path decided a Hub suggest (xor | judge | shortlist) and the raw
-- per-candidate XOR scores, so thresholds can be tuned offline.
ALTER TABLE "agent_tool_decisions"
  ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'judge',
  ADD COLUMN IF NOT EXISTS "scores" JSONB NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS "agent_tool_decisions_source_createdAt_idx"
  ON "agent_tool_decisions"("source", "createdAt");
