-- CreateTable
CREATE TABLE "public"."channel_stats" (
    "channelId" TEXT NOT NULL,
    "lastActivityAt" TIMESTAMP(3) NOT NULL,
    "participantCount" INTEGER NOT NULL DEFAULT 0,
    "addUserPolicy" "public"."ChannelAddUserPolicy" DEFAULT 'EVERYONE',

    CONSTRAINT "channel_stats_pkey" PRIMARY KEY ("channelId")
);

-- CreateIndex
CREATE INDEX "channel_stats_channelId_idx" ON "public"."channel_stats"("channelId");
