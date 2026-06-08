-- CreateEnum
CREATE TYPE "workflow"."AppIncomingWebhookType" AS ENUM ('SLACK', 'SENTINELONE');

-- CreateEnum
CREATE TYPE "workflow"."AppIncomingWebhookAction" AS ENUM ('MESSAGE', 'TICKET');

-- AlterTable
ALTER TABLE "workflow"."app_incoming_webhooks" ADD COLUMN     "action" "workflow"."AppIncomingWebhookAction" NOT NULL DEFAULT 'MESSAGE',
ADD COLUMN     "boardId" TEXT,
ADD COLUMN     "type" "workflow"."AppIncomingWebhookType" NOT NULL DEFAULT 'SLACK';

-- CreateIndex
CREATE INDEX "app_incoming_webhooks_boardId_idx" ON "workflow"."app_incoming_webhooks"("boardId");
