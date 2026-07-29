-- CreateTable
CREATE TABLE "non_zero"."scheduled_messages" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "messageContent" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "daysOfWeek" TEXT NOT NULL,
    "scheduledTime" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scheduled_messages_channelId_idx" ON "non_zero"."scheduled_messages"("channelId");

-- CreateIndex
CREATE INDEX "scheduled_messages_createdBy_idx" ON "non_zero"."scheduled_messages"("createdBy");
