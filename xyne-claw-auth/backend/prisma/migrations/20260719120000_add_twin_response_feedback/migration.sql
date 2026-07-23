-- CreateTable
CREATE TABLE "twin_response_feedback" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "channelId" TEXT,
    "channelName" TEXT,
    "sourceMessageId" TEXT,
    "incomingTask" TEXT,
    "deliveryAction" TEXT NOT NULL DEFAULT 'reply',
    "deliveryEmoji" TEXT,
    "destinationKind" TEXT,
    "draftMessage" TEXT,
    "finalMessage" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "proposedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "learnedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "twin_response_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "twin_response_feedback_userId_sourceMessageId_key" ON "twin_response_feedback"("userId", "sourceMessageId");

-- CreateIndex
CREATE INDEX "twin_response_feedback_userId_status_idx" ON "twin_response_feedback"("userId", "status");

-- CreateIndex
CREATE INDEX "twin_response_feedback_userId_decidedAt_idx" ON "twin_response_feedback"("userId", "decidedAt");

-- CreateIndex
CREATE INDEX "twin_response_feedback_status_proposedAt_idx" ON "twin_response_feedback"("status", "proposedAt");
