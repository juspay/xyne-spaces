-- CreateEnum
CREATE TYPE "ConversationParticipation" AS ENUM ('AUTHOR', 'MENTIONED');

-- CreateTable
CREATE TABLE "conversation_participants" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "participationType" "ConversationParticipation" NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_participants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conversation_participants_conversationId_idx" ON "conversation_participants"("conversationId");

-- CreateIndex
CREATE INDEX "conversation_participants_userId_idx" ON "conversation_participants"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_participants_conversationId_userId_key" ON "conversation_participants"("conversationId", "userId");

-- Backfill: Add all message senders as AUTHOR participants
INSERT INTO "conversation_participants" ("id", "conversationId", "userId", "participationType", "joinedAt")
SELECT 
    gen_random_uuid()::text,
    "conversationId",
    "senderId",
    'AUTHOR'::"ConversationParticipation",
    MIN("createdAt")
FROM "messages"
GROUP BY "conversationId", "senderId"
ON CONFLICT ("conversationId", "userId") DO NOTHING;
