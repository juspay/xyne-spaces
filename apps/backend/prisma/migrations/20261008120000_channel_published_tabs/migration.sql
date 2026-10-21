-- CreateTable
CREATE TABLE "public"."channel_published_tabs" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "publishedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_published_tabs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "channel_published_tabs_channelId_entityType_entityId_key" ON "public"."channel_published_tabs"("channelId", "entityType", "entityId");

