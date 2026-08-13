-- CreateTable
CREATE TABLE "public"."message_artifacts" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "conversationCreatedAt" TIMESTAMP(3) NOT NULL,
    "messagePreview" TEXT NOT NULL,
    "isInitialMessage" BOOLEAN NOT NULL,
    "visibleTo" TEXT,
    "type" TEXT NOT NULL,
    "command" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "callExternalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "message_artifacts_messageId_key"
ON "public"."message_artifacts"("messageId");

-- CreateIndex
CREATE INDEX "message_artifacts_workspaceId_type_status_updatedAt_idx"
ON "public"."message_artifacts"("workspaceId", "type", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "message_artifacts_channelId_idx"
ON "public"."message_artifacts"("channelId");
