-- CreateTable
CREATE TABLE "public"."message_artifacts" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "isInitialMessage" BOOLEAN NOT NULL,
    "messagePreview" TEXT NOT NULL,
    "messageCreatedAt" TIMESTAMP(3) NOT NULL,
    "command" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "callExternalId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "message_artifacts_messageId_key"
ON "public"."message_artifacts"("messageId");

-- CreateIndex
CREATE INDEX "message_artifacts_workspaceId_status_messageCreatedAt_idx"
ON "public"."message_artifacts"("workspaceId", "status", "messageCreatedAt");

-- CreateIndex
CREATE INDEX "message_artifacts_channelId_idx"
ON "public"."message_artifacts"("channelId");
