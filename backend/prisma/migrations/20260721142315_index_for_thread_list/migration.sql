-- CreateIndex
CREATE INDEX CONCURRENTLY "conversation_participants_thread_list_idx" ON "public"."conversation_participants"("userId", "isSubscribed", "lastReplyAt" DESC, "id" DESC);
