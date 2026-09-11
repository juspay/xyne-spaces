CREATE TABLE "public"."agent_conversation_shares" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sourceConversationId" TEXT NOT NULL,
    "sourceTipMessageId" TEXT NOT NULL,
    "agentSlug" TEXT NOT NULL,
    "targetChannelId" TEXT NOT NULL,
    "targetConversationId" TEXT NOT NULL,
    "targetMessageId" TEXT NOT NULL,
    "sharedBy" TEXT NOT NULL,
    "shareOperationId" TEXT NOT NULL,
    "sharedMessageCount" INTEGER NOT NULL,
    "agentAdded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agent_conversation_shares_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "agent_conversation_shares_targetConversationId_key"
ON "public"."agent_conversation_shares"("targetConversationId");
CREATE UNIQUE INDEX "agent_conversation_shares_targetMessageId_key"
ON "public"."agent_conversation_shares"("targetMessageId");
CREATE UNIQUE INDEX "agent_conversation_shares_workspace_channel_sharer_operation_key"
ON "public"."agent_conversation_shares"("workspaceId", "targetChannelId", "sharedBy", "shareOperationId");
CREATE INDEX "agent_conversation_shares_source_target_created_idx"
ON "public"."agent_conversation_shares"("workspaceId", "sourceConversationId", "targetChannelId", "createdAt" DESC);
