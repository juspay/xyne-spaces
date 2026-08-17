-- Agent-automations: self-proposed, event-driven agent wakeups.
--
-- An agent proposes an automation bound to a thread (conversationId); a human
-- approves it (HITL), which issues a unique signed webhook URL; each matching
-- delivery resumes the agent INSIDE that original conversation. Mirrors the
-- xyne-spaces generic external WEBHOOK trigger (URL secret = identity, encrypted
-- rotatable secret, declared body/header schema, optional per-source signature
-- verification, delivery-id idempotency). See src/agent-automations/*.

-- CreateTable
CREATE TABLE "agent_automations" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "approvedByUserId" TEXT,
    "agentSlug" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "channelId" TEXT,
    "workspaceId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'generic',
    "eventType" TEXT NOT NULL DEFAULT 'webhook',
    "bodySchema" JSONB,
    "headerSchema" JSONB,
    "matchPredicate" JSONB,
    "taskTemplate" TEXT NOT NULL,
    "secret" TEXT,
    "verifySource" TEXT,
    "signingSecret" TEXT,
    "signatureHeader" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
    "maxRuns" INTEGER,
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "lastRunAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_automations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_automation_runs" (
    "id" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "agentRunId" TEXT,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_automation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_automations_orgId_idx" ON "agent_automations"("orgId");

-- CreateIndex
CREATE INDEX "agent_automations_createdByUserId_idx" ON "agent_automations"("createdByUserId");

-- CreateIndex
CREATE INDEX "agent_automations_status_idx" ON "agent_automations"("status");

-- CreateIndex
CREATE INDEX "agent_automations_conversationId_idx" ON "agent_automations"("conversationId");

-- CreateIndex
CREATE INDEX "agent_automation_runs_automationId_idx" ON "agent_automation_runs"("automationId");

-- CreateIndex
CREATE UNIQUE INDEX "agent_automation_runs_automationId_deliveryId_key" ON "agent_automation_runs"("automationId", "deliveryId");

-- AddForeignKey
ALTER TABLE "agent_automation_runs" ADD CONSTRAINT "agent_automation_runs_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "agent_automations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
