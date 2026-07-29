-- CreateIndex
CREATE INDEX CONCURRENTLY IF NOT EXISTS "conversations_initialMessageId_idx" ON "public"."conversations"("initialMessageId");
