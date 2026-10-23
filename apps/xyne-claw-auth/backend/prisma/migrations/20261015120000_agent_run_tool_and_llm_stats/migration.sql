-- Claw metrics: agent_run_stats (one row per finished run) and agent_run_tool_stats
-- (one row per tool per run), written after a run's finalize commits. agent_runs
-- gains no columns, only the covering index at the end of this file.
--
-- Prod: build that index by hand first with CREATE INDEX CONCURRENTLY (same
-- definition); this file then skips it, and stops if it is INVALID. If the 5 s lock
-- wait below times out, nothing changed: run `prisma migrate resolve --rolled-back
-- 20261015120000_agent_run_tool_and_llm_stats` and deploy again. After deploy, an
-- admin runs the backfill (POST /claw/api/v1/metrics/tools/backfill).

SET lock_timeout = '5s';

-- CreateTable
CREATE TABLE "agent_run_stats" (
    "runId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "agentSlug" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL,
    "toolCalls" INTEGER NOT NULL,
    "toolErrors" INTEGER NOT NULL,
    "toolNames" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "llmCallCount" INTEGER,
    "llmCalls" JSONB,
    "citationOutcome" TEXT,

    CONSTRAINT "agent_run_stats_pkey" PRIMARY KEY ("runId")
);

-- CreateTable
CREATE TABLE "agent_run_tool_stats" (
    "runId" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "agentSlug" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL,
    "calls" INTEGER NOT NULL,
    "topLevelCalls" INTEGER NOT NULL,
    "errors" INTEGER NOT NULL,
    "recovered" INTEGER NOT NULL,
    "notFound" INTEGER NOT NULL,
    "dropped" INTEGER NOT NULL,
    "duplicates" INTEGER NOT NULL,
    "empty" INTEGER NOT NULL,
    "citeable" INTEGER NOT NULL,
    "cited" INTEGER NOT NULL,
    "totalMs" INTEGER NOT NULL,
    "maxMs" INTEGER NOT NULL,
    "resultBytes" INTEGER NOT NULL,
    "durationBuckets" INTEGER[],
    "errorClasses" JSONB,

    CONSTRAINT "agent_run_tool_stats_pkey" PRIMARY KEY ("runId","tool")
);

-- CreateIndex
CREATE INDEX "agent_run_stats_orgId_completedAt_idx" ON "agent_run_stats"("orgId", "completedAt");

-- CreateIndex
CREATE INDEX "agent_run_stats_orgId_agentSlug_completedAt_idx" ON "agent_run_stats"("orgId", "agentSlug", "completedAt");

-- CreateIndex
CREATE INDEX "agent_run_tool_stats_orgId_completedAt_idx" ON "agent_run_tool_stats"("orgId", "completedAt");

-- CreateIndex
CREATE INDEX "agent_run_tool_stats_orgId_tool_completedAt_idx" ON "agent_run_tool_stats"("orgId", "tool", "completedAt");

-- AddForeignKey
ALTER TABLE "agent_run_stats" ADD CONSTRAINT "agent_run_stats_runId_fkey" FOREIGN KEY ("runId") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_run_tool_stats" ADD CONSTRAINT "agent_run_tool_stats_runId_fkey" FOREIGN KEY ("runId") REFERENCES "agent_run_stats"("runId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Covering index for the run-level aggregates (index-only scans). Queries must spell
-- the partial predicate literally (ORPHAN_EXCLUSION in src/lib/metrics-core.ts).
-- Created only when missing: even CREATE INDEX IF NOT EXISTS waits for agent_runs writers.
DO $$
BEGIN
  IF to_regclass('"agent_runs_metrics_window_idx"') IS NULL THEN
    CREATE INDEX "agent_runs_metrics_window_idx" ON "agent_runs" ("orgId", "completedAt")
      INCLUDE ("id", "status", "agentSlug", "userId", "triggerSource", "startedAt", "parentSessionId", "totalMs",
               "llmTotalMs", "llmDecodeMs", "llmWaitMs", "toolMs", "ttftMs", "tokensPerSec", "tokensIn", "tokensOut",
               "tokensCacheRead", "tokensCacheWrite", "llmTurns", "llmRetries", "provider", "model", "rating")
      WHERE ("error" IS NULL OR "error" <> 'interrupted (orphaned run)');
  ELSIF NOT (SELECT indisvalid FROM pg_index WHERE indexrelid = to_regclass('"agent_runs_metrics_window_idx"')) THEN
    RAISE EXCEPTION 'agent_runs_metrics_window_idx is INVALID: DROP INDEX CONCURRENTLY it and build it again before deploying';
  END IF;
END $$;

-- Vacuum at 2% churn so the visibility map keeps the index above index-only.
ALTER TABLE "agent_runs" SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_insert_scale_factor = 0.02);
