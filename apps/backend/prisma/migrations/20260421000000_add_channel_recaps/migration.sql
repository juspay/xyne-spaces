-- CreateTable
CREATE TABLE "public"."channel_recaps" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "recapDate" DATE NOT NULL,
    "summary" TEXT NOT NULL,
    "userId" TEXT,

    CONSTRAINT "channel_recaps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "channel_recaps_recapDate_idx" ON "public"."channel_recaps"("recapDate");

-- CreateIndex
CREATE INDEX "channel_recaps_userId_idx" ON "public"."channel_recaps"("userId");
