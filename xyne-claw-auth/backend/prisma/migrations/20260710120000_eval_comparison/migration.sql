-- Multi-agent eval comparison: group the N sibling runs (one EvalGeneration per
-- agent, up to 3) of a single comparison under a shared comparisonId. ADDITIVE
-- ONLY — nullable, no FK, no backfill. Existing single-agent runs keep
-- comparisonId = NULL. Guards (IF NOT EXISTS) make a manual double-apply safe.

-- AlterTable
ALTER TABLE "eval_generations" ADD COLUMN IF NOT EXISTS "comparisonId" TEXT;
-- 0-based agent order within a comparison — keeps the "primary" (seq 0) baseline
-- stable across reloads (back-to-back inserts can share a startedAt millisecond).
ALTER TABLE "eval_generations" ADD COLUMN IF NOT EXISTS "comparisonSeq" INTEGER;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "eval_generations_comparisonId_idx" ON "eval_generations"("comparisonId");
