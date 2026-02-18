-- AlterEnum
ALTER TYPE "AttachmentEntityType" ADD VALUE 'DRAFT';

-- AlterTable
ALTER TABLE "message_attachments" ALTER COLUMN "conversationId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "draft_messages" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "conversationId" TEXT,
    "messageId" TEXT,
    "userId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "hasAttachment" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "draft_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "draft_messages_channelId_conversationId_messageId_userId_key" ON "draft_messages"("channelId", "conversationId", "messageId", "userId");