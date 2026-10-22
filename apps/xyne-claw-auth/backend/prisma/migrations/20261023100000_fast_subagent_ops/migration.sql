-- CreateTable
CREATE TABLE IF NOT EXISTS "fast_subagent_calls" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "agentSlug" TEXT NOT NULL,
    "subagentName" TEXT NOT NULL,
    "toolCallId" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "isError" BOOLEAN NOT NULL,
    "fast" BOOLEAN NOT NULL,
    "model" TEXT,
    "tokensIn" INTEGER NOT NULL,
    "tokensOut" INTEGER NOT NULL,
    "turns" INTEGER NOT NULL,
    "fallbacks" INTEGER NOT NULL,
    "xorCalls" INTEGER NOT NULL,
    "xorItems" INTEGER NOT NULL,
    "xorAnswers" INTEGER NOT NULL,
    "xorUnsure" INTEGER NOT NULL,
    "xorUnavailable" INTEGER NOT NULL,
    "xorCached" INTEGER NOT NULL,
    "quotaBlocked" INTEGER NOT NULL,
    CONSTRAINT "fast_subagent_calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "xor_review_samples" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "subagentName" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "item" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "verdict" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "xor_review_samples_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "fast_subagent_alerts" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "subagentName" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "baseline" DOUBLE PRECISION NOT NULL,
    "current" DOUBLE PRECISION NOT NULL,
    "samples" INTEGER NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    CONSTRAINT "fast_subagent_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "fast_subagent_calls_runId_toolCallId_key" ON "fast_subagent_calls"("runId", "toolCallId");
CREATE INDEX IF NOT EXISTS "fast_subagent_calls_orgId_subagentName_completedAt_idx" ON "fast_subagent_calls"("orgId", "subagentName", "completedAt");
CREATE INDEX IF NOT EXISTS "fast_subagent_calls_completedAt_idx" ON "fast_subagent_calls"("completedAt");
CREATE INDEX IF NOT EXISTS "xor_review_samples_orgId_subagentName_verdict_idx" ON "xor_review_samples"("orgId", "subagentName", "verdict");
CREATE INDEX IF NOT EXISTS "xor_review_samples_runId_idx" ON "xor_review_samples"("runId");
CREATE UNIQUE INDEX IF NOT EXISTS "fast_subagent_alerts_orgId_subagentName_kind_bucket_key" ON "fast_subagent_alerts"("orgId", "subagentName", "kind", "bucket");
CREATE INDEX IF NOT EXISTS "fast_subagent_alerts_orgId_createdAt_idx" ON "fast_subagent_alerts"("orgId", "createdAt");
