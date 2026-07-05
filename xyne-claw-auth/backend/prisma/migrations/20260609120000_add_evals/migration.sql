-- CreateTable
CREATE TABLE "eval_folders" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "source" TEXT,
    "sourceKind" TEXT,
    "sourceChannelId" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "eval_folders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eval_conversations" (
    "id" TEXT NOT NULL,
    "folderId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "turns" JSONB NOT NULL,
    "source" TEXT,
    "externalId" TEXT,
    "externalUpdatedAt" TIMESTAMP(3),
    "lastMessageId" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "eval_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eval_generations" (
    "id" TEXT NOT NULL,
    "agentSlug" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "genProvider" TEXT,
    "genModel" TEXT,
    "conversationIds" TEXT[],
    "folderId" TEXT,
    "createdBy" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "eval_generations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eval_generated_turns" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "turnIndex" INTEGER NOT NULL,
    "inputMessage" TEXT NOT NULL,
    "expectedResponse" TEXT,
    "clawAnswer" TEXT,
    "reasoning" TEXT,
    "toolInvocations" JSONB,
    "status" TEXT NOT NULL DEFAULT 'running',
    "clawConversationId" TEXT,
    "sessionId" TEXT,
    "matchScore" INTEGER,
    "judgeReasoning" TEXT,
    "judgeModel" TEXT,
    "judgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "eval_generated_turns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eval_judges" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "model" TEXT NOT NULL DEFAULT '',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "eval_judges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eval_verdicts" (
    "id" TEXT NOT NULL,
    "turnResultId" TEXT NOT NULL,
    "judgeId" TEXT NOT NULL,
    "judgeName" TEXT NOT NULL,
    "score" INTEGER,
    "reasoning" TEXT,
    "status" TEXT NOT NULL DEFAULT 'scored',
    "model" TEXT NOT NULL DEFAULT 'default',
    "passId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "eval_verdicts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "eval_folders_sourceChannelId_idx" ON "eval_folders"("sourceChannelId");

-- CreateIndex
CREATE INDEX "eval_conversations_folderId_createdAt_idx" ON "eval_conversations"("folderId", "createdAt");

-- CreateIndex
CREATE INDEX "eval_generations_folderId_startedAt_idx" ON "eval_generations"("folderId", "startedAt");

-- CreateIndex
CREATE INDEX "eval_generated_turns_runId_idx" ON "eval_generated_turns"("runId");

-- CreateIndex
CREATE INDEX "eval_generated_turns_conversationId_idx" ON "eval_generated_turns"("conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "eval_generated_turns_runId_conversationId_turnIndex_key" ON "eval_generated_turns"("runId", "conversationId", "turnIndex");

-- CreateIndex
CREATE INDEX "eval_verdicts_turnResultId_idx" ON "eval_verdicts"("turnResultId");

-- CreateIndex
CREATE UNIQUE INDEX "eval_verdicts_turnResultId_judgeId_model_key" ON "eval_verdicts"("turnResultId", "judgeId", "model");

-- AddForeignKey
ALTER TABLE "eval_conversations" ADD CONSTRAINT "eval_conversations_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "eval_folders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eval_generated_turns" ADD CONSTRAINT "eval_generated_turns_runId_fkey" FOREIGN KEY ("runId") REFERENCES "eval_generations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eval_generated_turns" ADD CONSTRAINT "eval_generated_turns_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "eval_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eval_verdicts" ADD CONSTRAINT "eval_verdicts_turnResultId_fkey" FOREIGN KEY ("turnResultId") REFERENCES "eval_generated_turns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

