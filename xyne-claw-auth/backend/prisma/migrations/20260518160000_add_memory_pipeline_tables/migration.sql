-- Memory pipeline tables: HITL review state + recall-hit tracking for the
-- "hot memories" admin panel. The cron in claw-auth populates these; the
-- Memory tab in the agent admin UI reads them.

-- CreateTable: pending_memory_reviews
-- Per-memory approval row (legacy single-memory flow). Most prod use goes
-- through pending_batch_reviews now, but this table is still read by the
-- memory router for the per-review approve/reject path.
CREATE TABLE IF NOT EXISTS "pending_memory_reviews" (
    "id" TEXT NOT NULL,
    "agentSlug" TEXT NOT NULL,
    "userId" TEXT,
    "hindsightMemoryId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "category" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "spacesMessageId" TEXT,
    "curatorReasoning" TEXT,
    "curatorConfidence" DOUBLE PRECISION,
    "tokensIn" INTEGER,
    "tokensOut" INTEGER,
    "toolCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "pending_memory_reviews_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "pending_memory_reviews_status_idx"
    ON "pending_memory_reviews"("status");
CREATE INDEX IF NOT EXISTS "pending_memory_reviews_agentSlug_idx"
    ON "pending_memory_reviews"("agentSlug");
CREATE INDEX IF NOT EXISTS "pending_memory_reviews_agentSlug_status_idx"
    ON "pending_memory_reviews"("agentSlug", "status");

-- CreateTable: pending_batch_reviews
-- One row per (agent, date). The cron groups the day's transcripts and
-- creates one of these per agent; admin approves/rejects in one click.
-- Only on approval does the transcript reach the memory provider — rejected
-- batches cost zero LLM extraction tokens.
CREATE TABLE IF NOT EXISTS "pending_batch_reviews" (
    "id" TEXT NOT NULL,
    "agentSlug" TEXT NOT NULL,
    "reviewDate" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "sessionIds" TEXT[],
    "approvedSessionIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "heuristicSkipped" JSONB,
    "spacesMessageId" TEXT,
    "retainedMemoryIds" JSONB,
    "approvalStrategy" TEXT NOT NULL DEFAULT 'HUMAN_ONLY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "pending_batch_reviews_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "pending_batch_reviews_agentSlug_reviewDate_key"
    ON "pending_batch_reviews"("agentSlug", "reviewDate");
CREATE INDEX IF NOT EXISTS "pending_batch_reviews_status_idx"
    ON "pending_batch_reviews"("status");
CREATE INDEX IF NOT EXISTS "pending_batch_reviews_agentSlug_status_idx"
    ON "pending_batch_reviews"("agentSlug", "status");

-- CreateTable: memory_recall_hits
-- One row per recalled memory per session start. Ingested by the nightly
-- cron from xyne-claw's data/recall-hits/<date>.jsonl. Drives the Hot
-- Memories panel in the agent admin UI.
CREATE TABLE IF NOT EXISTS "memory_recall_hits" (
    "id" TEXT NOT NULL,
    "agentSlug" TEXT NOT NULL,
    "hindsightMemoryId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "rank" INTEGER,
    "recalledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "memory_recall_hits_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "memory_recall_hits_agentSlug_recalledAt_idx"
    ON "memory_recall_hits"("agentSlug", "recalledAt");
CREATE INDEX IF NOT EXISTS "memory_recall_hits_hindsightMemoryId_idx"
    ON "memory_recall_hits"("hindsightMemoryId");
