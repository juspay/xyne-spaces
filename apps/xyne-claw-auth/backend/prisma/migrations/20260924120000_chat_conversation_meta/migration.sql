-- Per-conversation metadata for Ask AI chats. Conversations are otherwise just
-- a grouping of chat_messages rows; a generated title, a user's rename and a
-- pin are the first things that belong to the conversation itself rather than
-- to one message.
--
-- Rename needs no column of its own: `title` doubles as the override, and the
-- generator is gated on `title IS NULL`, so a user-chosen name is never
-- overwritten by a later turn.
CREATE TABLE "chat_conversation_meta" (
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "agentSlug" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "title" TEXT,
    "titleGeneratedAt" TIMESTAMP(3),
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "chat_conversation_meta_pkey" PRIMARY KEY ("conversationId")
);

CREATE INDEX "chat_conversation_meta_userId_agentSlug_idx" ON "chat_conversation_meta"("userId", "agentSlug");
CREATE INDEX "chat_conversation_meta_orgId_idx" ON "chat_conversation_meta"("orgId");

-- Partial: only pinned rows are ever looked up by this, and they are a tiny
-- minority of a user's chats.
CREATE INDEX "chat_conversation_meta_userId_agentSlug_pinned_idx"
  ON "chat_conversation_meta" ("userId", "agentSlug") WHERE "pinned";
