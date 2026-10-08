-- CreateTable
CREATE TABLE "public"."channel_published_apps" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "publishedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_published_apps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "channel_published_apps_channelId_position_idx" ON "public"."channel_published_apps"("channelId", "position");

-- CreateIndex
CREATE INDEX "channel_published_apps_workspaceId_idx" ON "public"."channel_published_apps"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "channel_published_apps_channelId_appId_key" ON "public"."channel_published_apps"("channelId", "appId");

