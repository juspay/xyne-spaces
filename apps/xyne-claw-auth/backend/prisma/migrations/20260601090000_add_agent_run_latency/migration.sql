-- AlterTable: per-run latency breakdown from claw's LatencyMetrics
ALTER TABLE "agent_runs"
  ADD COLUMN "totalMs"          INTEGER,
  ADD COLUMN "llmTotalMs"       INTEGER,
  ADD COLUMN "llmDecodeMs"      INTEGER,
  ADD COLUMN "llmWaitMs"        INTEGER,
  ADD COLUMN "llmTurns"         INTEGER,
  ADD COLUMN "llmRetries"       INTEGER,
  ADD COLUMN "ttftMs"           INTEGER,
  ADD COLUMN "tokensPerSec"     INTEGER,
  ADD COLUMN "toolMs"           INTEGER,
  ADD COLUMN "lastRetryReason"  TEXT;
