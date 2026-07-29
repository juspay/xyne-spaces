/*
  Warnings:

  - You are about to drop the column `authTag` on the `user_agent_configs` table. All the data in the column will be lost.
  - You are about to drop the column `baseUrl` on the `user_agent_configs` table. All the data in the column will be lost.
  - You are about to drop the column `encryptedKey` on the `user_agent_configs` table. All the data in the column will be lost.
  - You are about to drop the column `iv` on the `user_agent_configs` table. All the data in the column will be lost.
  - You are about to drop the column `model` on the `user_agent_configs` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "agent_requests" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "user_agent_configs" DROP COLUMN "authTag",
DROP COLUMN "baseUrl",
DROP COLUMN "encryptedKey",
DROP COLUMN "iv",
DROP COLUMN "model";

-- CreateTable
CREATE TABLE "user_provider_credentials" (
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "encryptedKey" TEXT,
    "iv" TEXT,
    "authTag" TEXT,
    "model" TEXT,
    "baseUrl" TEXT,
    "authType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_provider_credentials_pkey" PRIMARY KEY ("userId","provider")
);

-- CreateTable
CREATE TABLE "user_subagent_configs" (
    "userId" TEXT NOT NULL,
    "subagentName" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_subagent_configs_pkey" PRIMARY KEY ("userId","subagentName")
);

-- CreateTable
CREATE TABLE "agent_runs" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "agentSlug" TEXT NOT NULL,
    "triggerSource" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "currentToolLabel" TEXT,
    "task" TEXT NOT NULL,
    "conversationId" TEXT,
    "scheduledJobId" TEXT,
    "channelId" TEXT,
    "result" TEXT,
    "error" TEXT,
    "toolsUsed" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "toolInvocations" JSONB,
    "tokensIn" INTEGER,
    "tokensOut" INTEGER,
    "tokensCacheRead" INTEGER,
    "tokensCacheWrite" INTEGER,
    "rating" TEXT,
    "ratingComment" TEXT,
    "ratedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_attachments" (
    "id" TEXT NOT NULL,
    "chatMessageId" TEXT,
    "uploaderUserId" TEXT NOT NULL,
    "storageProvider" TEXT NOT NULL DEFAULT 'gcs',
    "url" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "originalFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_runs_sessionId_key" ON "agent_runs"("sessionId");

-- CreateIndex
CREATE INDEX "agent_runs_userId_status_startedAt_idx" ON "agent_runs"("userId", "status", "startedAt");

-- CreateIndex
CREATE INDEX "agent_runs_agentSlug_startedAt_idx" ON "agent_runs"("agentSlug", "startedAt");

-- CreateIndex
CREATE INDEX "chat_attachments_chatMessageId_idx" ON "chat_attachments"("chatMessageId");

-- CreateIndex
CREATE INDEX "chat_attachments_uploaderUserId_createdAt_idx" ON "chat_attachments"("uploaderUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "user_provider_credentials" ADD CONSTRAINT "user_provider_credentials_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_subagent_configs" ADD CONSTRAINT "user_subagent_configs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_attachments" ADD CONSTRAINT "chat_attachments_chatMessageId_fkey" FOREIGN KEY ("chatMessageId") REFERENCES "chat_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
