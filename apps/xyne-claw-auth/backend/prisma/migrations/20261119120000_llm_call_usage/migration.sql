-- CreateTable
CREATE TABLE "llm_call_usage" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT,
    "agentSlug" TEXT,
    "runId" TEXT,
    "conversationId" TEXT,
    "ticketId" TEXT,
    "triggerSource" TEXT,
    "callPurpose" TEXT NOT NULL,
    "subagentName" TEXT,
    "callOutcome" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "billingBasis" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "servedModel" TEXT,
    "serviceTier" TEXT NOT NULL DEFAULT 'standard',
    "usageReported" BOOLEAN NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "cacheReadTokens" INTEGER NOT NULL,
    "cacheWriteTokens" INTEGER NOT NULL,
    "costUsd" DECIMAL(14,8),
    "priceId" TEXT,
    "slabOverPromptTokens" INTEGER,
    "toolNames" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "responseId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "llm_call_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "llm_model_prices" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "serviceTier" TEXT NOT NULL DEFAULT 'standard',
    "inputPerMTok" DECIMAL(12,6) NOT NULL,
    "outputPerMTok" DECIMAL(12,6) NOT NULL,
    "cacheReadPerMTok" DECIMAL(12,6) NOT NULL,
    "cacheWritePerMTok" DECIMAL(12,6) NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "slabs" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "llm_model_prices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "llm_call_usage_orgId_startedAt_idx" ON "llm_call_usage"("orgId", "startedAt");

-- CreateIndex
CREATE INDEX "llm_call_usage_orgId_userId_startedAt_idx" ON "llm_call_usage"("orgId", "userId", "startedAt");

-- CreateIndex
CREATE INDEX "llm_call_usage_conversationId_startedAt_idx" ON "llm_call_usage"("conversationId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "llm_model_prices_provider_model_serviceTier_effectiveFrom_key" ON "llm_model_prices"("provider", "model", "serviceTier", "effectiveFrom");

