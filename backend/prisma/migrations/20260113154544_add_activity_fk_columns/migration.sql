ALTER TABLE "activities" ADD COLUMN "messageId" TEXT,
ADD COLUMN "reactionId" TEXT,
ADD COLUMN "callId" TEXT;

CREATE INDEX "activities_messageId_idx" ON "activities"("messageId");
CREATE INDEX "activities_reactionId_idx" ON "activities"("reactionId");
CREATE INDEX "activities_callId_idx" ON "activities"("callId");
