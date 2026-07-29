-- Phase 2 (Gap 1): denormalized nullable orgId on the 12 agentSlug-keyed child
-- tables. ADDITIVE ONLY — nullable, no FK (org is derivable from the row's
-- agent/user; the column is for the slice-5 composite-unique swap + org-filtered
-- reads). Backfilled by scripts/backfill-phase2-child-orgid.ts, then flipped NOT
-- NULL in the slice-5 migration. Guards (IF NOT EXISTS) make a manual double-
-- apply via `prisma db execute` safe (round-2 review gap #9).

-- AlterTable
ALTER TABLE "user_agent_configs" ADD COLUMN IF NOT EXISTS "orgId" TEXT;
ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "orgId" TEXT;
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "orgId" TEXT;
ALTER TABLE "agent_requests" ADD COLUMN IF NOT EXISTS "orgId" TEXT;
ALTER TABLE "scheduled_jobs" ADD COLUMN IF NOT EXISTS "orgId" TEXT;
ALTER TABLE "pending_memory_reviews" ADD COLUMN IF NOT EXISTS "orgId" TEXT;
ALTER TABLE "pending_batch_reviews" ADD COLUMN IF NOT EXISTS "orgId" TEXT;
ALTER TABLE "memory_recall_hits" ADD COLUMN IF NOT EXISTS "orgId" TEXT;
ALTER TABLE "active_goals" ADD COLUMN IF NOT EXISTS "orgId" TEXT;
ALTER TABLE "agent_improvement_candidates" ADD COLUMN IF NOT EXISTS "orgId" TEXT;
ALTER TABLE "agent_curator_state" ADD COLUMN IF NOT EXISTS "orgId" TEXT;
ALTER TABLE "eval_generations" ADD COLUMN IF NOT EXISTS "orgId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "user_agent_configs_orgId_idx" ON "user_agent_configs"("orgId");
CREATE INDEX IF NOT EXISTS "agent_runs_orgId_idx" ON "agent_runs"("orgId");
CREATE INDEX IF NOT EXISTS "chat_messages_orgId_idx" ON "chat_messages"("orgId");
CREATE INDEX IF NOT EXISTS "agent_requests_orgId_idx" ON "agent_requests"("orgId");
CREATE INDEX IF NOT EXISTS "scheduled_jobs_orgId_idx" ON "scheduled_jobs"("orgId");
CREATE INDEX IF NOT EXISTS "pending_memory_reviews_orgId_idx" ON "pending_memory_reviews"("orgId");
CREATE INDEX IF NOT EXISTS "pending_batch_reviews_orgId_idx" ON "pending_batch_reviews"("orgId");
CREATE INDEX IF NOT EXISTS "memory_recall_hits_orgId_idx" ON "memory_recall_hits"("orgId");
CREATE INDEX IF NOT EXISTS "active_goals_orgId_idx" ON "active_goals"("orgId");
CREATE INDEX IF NOT EXISTS "agent_improvement_candidates_orgId_idx" ON "agent_improvement_candidates"("orgId");
CREATE INDEX IF NOT EXISTS "agent_curator_state_orgId_idx" ON "agent_curator_state"("orgId");
CREATE INDEX IF NOT EXISTS "eval_generations_orgId_idx" ON "eval_generations"("orgId");
