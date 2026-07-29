-- CreateIndex
CREATE INDEX CONCURRENTLY IF NOT EXISTS "channel_participants_channelId_userId_id_key" ON "public"."channel_participants"("channelId", "userId", "id");

-- CreateIndex
CREATE INDEX CONCURRENTLY IF NOT EXISTS "channels_visibility_id_idx" ON "public"."channels"("visibility", "id");

-- CreateIndex
CREATE INDEX CONCURRENTLY IF  NOT EXISTS "conversation_participants_conversationId_participationType__idx" ON "public"."conversation_participants"("conversationId", "participationType", "joinedAt", "id");

-- CreateIndex
CREATE INDEX CONCURRENTLY IF NOT EXISTS "draft_messages_userId_id_idx" ON "public"."draft_messages"("userId", "id");

-- CreateIndex
CREATE INDEX CONCURRENTLY IF NOT EXISTS "message_attachments_entityId_id_idx" ON "public"."message_attachments"("entityId", "id");

-- CreateIndex
CREATE INDEX CONCURRENTLY IF NOT EXISTS "reaction_counts_messageId_countId_idx" ON "public"."reaction_counts"("messageId", "countId");

-- CreateIndex
CREATE INDEX CONCURRENTLY IF NOT EXISTS "reactions_messageId_reactionId_idx" ON "public"."reactions"("messageId", "reactionId");

-- CreateIndex
CREATE INDEX CONCURRENTLY IF NOT EXISTS "stages_boardId_sequenceNumber_idx" ON "public"."stages"("boardId", "sequenceNumber");

-- CreateIndex
CREATE INDEX CONCURRENTLY IF NOT EXISTS "user_group_mappings_userGroupId_createdAt_id_idx" ON "public"."user_group_mappings"("userGroupId", "createdAt" DESC , "id" ASC);

-- CreateIndex
CREATE INDEX CONCURRENTLY IF NOT EXISTS "conversations_channelId_createdAt_conversationId_idx" ON "public"."conversations"("channelId", "createdAt" DESC , "conversationId" ASC);
