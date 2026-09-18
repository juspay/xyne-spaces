-- AlterTable
-- Denormalized copy of conversation.channelId, stamped on insert by the write paths.
-- Nullable with no default and NULL is meaningful, not just "not backfilled yet": a row with a
-- NULL channelId is not anchored to a conversation (generic uploads, canvases, collections,
-- workflow steps, desk reports) and must never appear in a channel-scoped read.
--
-- Existing rows start NULL. Backfill from conversations fills the conversation-anchored ones:
--   UPDATE "public"."message_attachments" a
--      SET "channelId" = c."channelId"
--     FROM "public"."conversations" c
--    WHERE a."conversationId" = c."conversationId"
--      AND a."channelId" IS NULL
--      AND a."conversationId" IS NOT NULL
-- Batch it — the table is ~2.1M rows. Run it as an admin endpoint in xyne-spaces-private,
-- following POST /migrate/api/admin/email-read-flag-backfill.
--
-- getConversationAttachementsV2 now filters on channelId directly, so the backfill is a
-- PREREQUISITE for that reader, not an optimization: rows still NULL will not match it.
-- Deploy order is backfill-then-reader.
ALTER TABLE "public"."message_attachments" ADD COLUMN "channelId" TEXT;

-- CreateIndex
-- (workspaceId, channelId, createdAt DESC, id) is the channel file list's access path: one range
-- seek per channel instead of an ordered walk of every attachment in the workspace. The trailing
-- id keeps the ordering total so keyset pagination cannot skip or repeat a row on a createdAt tie.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "message_attachments_workspaceId_channelId_createdAt_id_idx" ON "public"."message_attachments"("workspaceId", "channelId", "createdAt" DESC, "id");
