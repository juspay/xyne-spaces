-- AlterTable
-- Backfill (batch it; ~2.1M rows) must run BEFORE getConversationAttachementsV2 ships, or
-- rows still NULL will not match it:
--   UPDATE "public"."message_attachments" a
--      SET "channelId" = c."channelId"
--     FROM "public"."conversations" c
--    WHERE a."conversationId" = c."conversationId"
--      AND a."channelId" IS NULL
--      AND a."conversationId" IS NOT NULL
ALTER TABLE "public"."message_attachments" ADD COLUMN "channelId" TEXT;

-- CreateIndex
CREATE INDEX CONCURRENTLY IF NOT EXISTS "message_attachments_workspaceId_channelId_createdAt_id_idx" ON "public"."message_attachments"("workspaceId", "channelId", "createdAt" DESC, "id");
