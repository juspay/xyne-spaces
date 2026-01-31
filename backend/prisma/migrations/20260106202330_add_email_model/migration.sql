-- CreateEnum
CREATE TYPE "EmailType" AS ENUM ('DEFAULT', 'REPLY', 'REPLY_ALL');

-- CreateEnum
CREATE TYPE "ChannelType" AS ENUM ('DEFAULT', 'EMAIL');

-- CreateEnum
CREATE TYPE "ExternalEntityType" AS ENUM ('MESSAGE', 'EMAIL');

-- AlterEnum
ALTER TYPE "AttachmentEntityType" ADD VALUE 'EMAIL';

-- CreateTable
CREATE TABLE "emails" (
    "id" TEXT NOT NULL,
    "type" "EmailType" NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "to" TEXT[],
    "from" TEXT NOT NULL,
    "cc" TEXT[] DEFAULT '{}',
    "bcc" TEXT[] DEFAULT '{}',
    "conversationId" TEXT NOT NULL,
    "externalThreadId" TEXT NOT NULL,
    "externalMessageId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "emails_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "channels" ADD COLUMN "type" "ChannelType" NOT NULL DEFAULT 'DEFAULT';

-- AlterTable
ALTER TABLE "tickets" ADD COLUMN "channelId" TEXT NOT NULL;
ALTER TABLE "tickets" ADD COLUMN "merchantId" TEXT;

-- AlterTable
ALTER TABLE "external_messages" ADD COLUMN "entityType" "ExternalEntityType" NOT NULL DEFAULT 'MESSAGE';
ALTER TABLE "external_messages" ADD COLUMN "entityId" TEXT;

-- CreateIndex
CREATE INDEX "emails_conversationId_idx" ON "emails"("conversationId");

-- CreateIndex
CREATE INDEX "emails_externalThreadId_idx" ON "emails"("externalThreadId");

-- CreateIndex
CREATE INDEX "emails_externalMessageId_idx" ON "emails"("externalMessageId");

