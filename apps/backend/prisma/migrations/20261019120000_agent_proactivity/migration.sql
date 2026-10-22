-- Agents answering channel questions without a mention: the channel's mode, and the
-- record of every question XOR judged and what came of it.
ALTER TABLE "public"."channels" ADD COLUMN "agentProactivityMode" TEXT NOT NULL DEFAULT 'OFF';

CREATE TABLE "non_zero"."agent_proactivity_decisions" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "messageIds" TEXT[],
    "conversationId" TEXT,
    "parentEpisodeId" TEXT,
    "gate" TEXT NOT NULL,
    "agentSlug" TEXT,
    "outcome" TEXT,
    "reason" TEXT,
    "score" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_proactivity_decisions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "agent_proactivity_decisions_channelId_createdAt_idx" ON "non_zero"."agent_proactivity_decisions"("channelId", "createdAt");
CREATE INDEX "agent_proactivity_decisions_channelId_senderId_createdAt_idx" ON "non_zero"."agent_proactivity_decisions"("channelId", "senderId", "createdAt");
CREATE INDEX "agent_proactivity_decisions_conversationId_idx" ON "non_zero"."agent_proactivity_decisions"("conversationId");
CREATE INDEX "agent_proactivity_decisions_parentEpisodeId_idx" ON "non_zero"."agent_proactivity_decisions"("parentEpisodeId");
CREATE INDEX "agent_proactivity_decisions_messageIds_idx" ON "non_zero"."agent_proactivity_decisions" USING GIN ("messageIds");

CREATE TABLE "non_zero"."agent_proactivity_xor_calls" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "agentSlug" TEXT,
    "input" TEXT NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "failed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_proactivity_xor_calls_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "non_zero"."agent_proactivity_xor_questions" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "criteriaTrue" TEXT,
    "criteriaFalse" TEXT,
    "probability" DOUBLE PRECISION,

    CONSTRAINT "agent_proactivity_xor_questions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "agent_proactivity_xor_calls_decisionId_idx" ON "non_zero"."agent_proactivity_xor_calls"("decisionId");
CREATE INDEX "agent_proactivity_xor_questions_callId_idx" ON "non_zero"."agent_proactivity_xor_questions"("callId");
