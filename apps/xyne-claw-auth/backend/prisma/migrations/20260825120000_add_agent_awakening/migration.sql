-- CreateTable
CREATE TABLE "agent_awakening_state" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "nextDueAt" TIMESTAMP(3) NOT NULL,
    "lastTickAt" TIMESTAMP(3),
    "watermarkAt" TIMESTAMP(3) NOT NULL,
    "watermarkMessageId" TEXT,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "consecutiveSkips" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "reflexNextCheckAt" TIMESTAMP(3),
    "reflexWatermarkAt" TIMESTAMP(3),
    "reflexLastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_awakening_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_awakening_runs" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "windowStartMs" BIGINT NOT NULL,
    "windowEndMs" BIGINT NOT NULL,
    "outcome" TEXT NOT NULL,
    "skipReason" TEXT,
    "eventCount" INTEGER NOT NULL DEFAULT 0,
    "signals" JSONB,
    "sessionId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "artifactUri" TEXT,
    "injectionsUsed" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "agent_awakening_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_awakening_state_agentId_key" ON "agent_awakening_state"("agentId");

-- CreateIndex
CREATE INDEX "agent_awakening_state_enabled_nextDueAt_idx" ON "agent_awakening_state"("enabled", "nextDueAt");

-- CreateIndex
CREATE INDEX "agent_awakening_state_enabled_reflexNextCheckAt_idx" ON "agent_awakening_state"("enabled", "reflexNextCheckAt");

-- CreateIndex
CREATE INDEX "agent_awakening_state_orgId_idx" ON "agent_awakening_state"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "agent_awakening_runs_idempotencyKey_key" ON "agent_awakening_runs"("idempotencyKey");

-- CreateIndex
CREATE INDEX "agent_awakening_runs_agentId_windowStartMs_idx" ON "agent_awakening_runs"("agentId", "windowStartMs");

-- CreateIndex
CREATE INDEX "agent_awakening_runs_orgId_startedAt_idx" ON "agent_awakening_runs"("orgId", "startedAt");
