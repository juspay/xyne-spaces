-- CreateEnum
CREATE TYPE "public"."DelayedMessageStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED', 'CANCELLED');

-- CreateTable (DelayedMessage)
CREATE TABLE "public"."delayed_messages" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "conversationId" TEXT,
    "senderId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "hasAttachment" BOOLEAN NOT NULL DEFAULT false,
    "scheduledFor" DOUBLE PRECISION NOT NULL,
    "status" "public"."DelayedMessageStatus" NOT NULL DEFAULT 'PENDING',
    "failureReason" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delayed_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "delayed_messages_senderId_status_idx" ON "public"."delayed_messages"("senderId", "status");

-- CreateIndex
CREATE INDEX "delayed_messages_senderId_scheduledFor_idx" ON "public"."delayed_messages"("senderId", "scheduledFor");

-- CreateIndex
CREATE INDEX "delayed_messages_scheduledFor_status_idx" ON "public"."delayed_messages"("scheduledFor", "status");

-- CreateIndex
CREATE INDEX "delayed_messages_channelId_status_idx" ON "public"."delayed_messages"("channelId", "status");
