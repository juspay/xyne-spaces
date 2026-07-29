-- Add denormalized columns to conversation_participants for optimized thread listing.
--
-- lastReplyAt: set to conversation.lastActivityAt when a reply is sent.
-- NULL means no replies. Enables ORDER BY + LIMIT on the participant table
-- directly, avoiding the FlippedJoin N+1 problem. IS NOT NULL filter
-- replaces the replyCount > 0 check.
--
-- channelId: enables direct channel relationship for ACL, avoiding the 2-hop
-- conversation→channel join that scanned all conversations in the channel.

-- Add columns
ALTER TABLE "conversation_participants" ADD COLUMN IF NOT EXISTS "lastReplyAt" TIMESTAMP;
ALTER TABLE "conversation_participants" ADD COLUMN IF NOT EXISTS "channelId" TEXT;

-- Add index for userConversationsPaginatedV2 query:
-- conversation_participants.where(userId).where(lastReplyAt IS NOT NULL).orderBy(lastReplyAt DESC).limit(10)
-- SQLite converts IS NOT NULL into lastReplyAt > ?, using the index to skip NULLs.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "conversation_participants_userId_lastReplyAt_id_idx"
ON "conversation_participants" ("userId", "lastReplyAt" DESC, "id" ASC);

-- Add index for ACL channel lookup
CREATE INDEX CONCURRENTLY IF NOT EXISTS "conversation_participants_channelId_idx"
ON "conversation_participants" ("channelId");
