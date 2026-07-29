-- CreateEnum
CREATE TYPE "workflow"."Platform" AS ENUM ('WEB', 'ELECTRON', 'MOBILE');

-- CreateTable
CREATE TABLE "workflow"."user_activity_events" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "eventCategory" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "eventLabel" TEXT,
    "url" TEXT NOT NULL,
    "triggerType" TEXT NOT NULL DEFAULT 'CLICK',
    "contextMetadata" JSONB,
    "platform" "workflow"."Platform" NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_activity_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_activity_events_userId_idx" ON "workflow"."user_activity_events"("userId");

-- CreateIndex
CREATE INDEX "user_activity_events_eventCategory_idx" ON "workflow"."user_activity_events"("eventCategory");

-- CreateIndex
CREATE INDEX "user_activity_events_eventName_idx" ON "workflow"."user_activity_events"("eventName");

-- CreateIndex
CREATE INDEX "user_activity_events_timestamp_idx" ON "workflow"."user_activity_events"("timestamp");
