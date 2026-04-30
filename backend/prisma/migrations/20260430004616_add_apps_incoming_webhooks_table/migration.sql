-- CreateTable AppIncomingWebhook
CREATE TABLE "workflow"."app_incoming_webhooks" (
    "id" TEXT NOT NULL,
    "installedAppId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedBy" TEXT,

    CONSTRAINT "app_incoming_webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "app_incoming_webhooks_installedAppId_channelId_idx" ON "workflow"."app_incoming_webhooks"("installedAppId", "channelId");

-- CreateIndex
CREATE INDEX "app_incoming_webhooks_installedAppId_idx" ON "workflow"."app_incoming_webhooks"("installedAppId");

-- CreateIndex
CREATE INDEX "app_incoming_webhooks_secret_idx" ON "workflow"."app_incoming_webhooks"("secret");
