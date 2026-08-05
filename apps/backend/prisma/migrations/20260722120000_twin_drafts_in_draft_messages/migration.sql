ALTER TABLE "public"."draft_messages"
  ADD COLUMN "origin" TEXT,
  ADD COLUMN "metadata" TEXT;

DROP INDEX IF EXISTS "public"."draft_messages_channelId_conversationId_messageId_userId_key";

CREATE INDEX CONCURRENTLY IF NOT EXISTS "draft_messages_userId_origin_idx" ON "public"."draft_messages"("userId", "origin");

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "draft_messages_channelId_conversationId_messageId_userId_key"
  ON "public"."draft_messages"("channelId", "conversationId", "messageId", "userId")
  WHERE "origin" IS DISTINCT FROM 'twin';
