-- CreateTable
CREATE TABLE "channel_daily_recaps" (
    "channelId" TEXT NOT NULL,
    "recapDate" DATE NOT NULL,
    "summary" TEXT NOT NULL,

    CONSTRAINT "channel_daily_recaps_pkey" PRIMARY KEY ("channelId","recapDate")
);

-- CreateIndex
CREATE INDEX "channel_daily_recaps_recapDate_idx" ON "channel_daily_recaps"("recapDate");

-- AlterTable
ALTER TABLE "channel_user_status" ADD COLUMN "isRecapSubscribed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "channel_user_status" ADD COLUMN "lastSeenRecapDate" DATE;

-- CreateIndex
CREATE INDEX "channel_user_status_userId_isRecapSubscribed_idx" ON "channel_user_status"("userId", "isRecapSubscribed");