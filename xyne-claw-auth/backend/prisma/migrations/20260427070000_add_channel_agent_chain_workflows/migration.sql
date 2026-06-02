-- CreateTable
CREATE TABLE "agent_chain_workflows" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "definition" JSONB NOT NULL,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_chain_workflows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_agent_chain_bindings" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "entryAgentSlug" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_agent_chain_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_chain_workflows_createdByUserId_idx" ON "agent_chain_workflows"("createdByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "channel_agent_chain_bindings_channelId_entryAgentSlug_key" ON "channel_agent_chain_bindings"("channelId", "entryAgentSlug");

-- CreateIndex
CREATE INDEX "channel_agent_chain_bindings_workflowId_idx" ON "channel_agent_chain_bindings"("workflowId");

-- CreateIndex
CREATE INDEX "channel_agent_chain_bindings_channelId_idx" ON "channel_agent_chain_bindings"("channelId");

-- AddForeignKey
ALTER TABLE "agent_chain_workflows" ADD CONSTRAINT "agent_chain_workflows_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_agent_chain_bindings" ADD CONSTRAINT "channel_agent_chain_bindings_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "agent_chain_workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_agent_chain_bindings" ADD CONSTRAINT "channel_agent_chain_bindings_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
