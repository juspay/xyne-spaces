-- SDLCT-0002: Notification Log Pipeline Completeness Check
-- Append-only, workspace-scoped notification lifecycle audit trail.

-- CreateEnum
CREATE TYPE "non_zero"."NotificationLogEventType" AS ENUM (
  'NOTIFICATION_CREATED',
  'DELIVERY_PLANNED',
  'QUEUE_ENQUEUED',
  'QUEUE_PROCESSING_STARTED',
  'PROVIDER_REQUEST_STARTED',
  'PROVIDER_ACCEPTED',
  'PROVIDER_REJECTED',
  'DELIVERY_RETRY_SCHEDULED',
  'DELIVERY_FAILED_FINAL',
  'DELIVERY_SKIPPED',
  'CLIENT_RECEIVED',
  'CLIENT_DISPLAYED',
  'USER_OPENED',
  'USER_ACKNOWLEDGED'
);

-- CreateEnum
CREATE TYPE "non_zero"."NotificationLogStatus" AS ENUM (
  'STARTED',
  'SUCCESS',
  'FAILED',
  'RETRYING',
  'SKIPPED'
);

-- CreateEnum
CREATE TYPE "non_zero"."NotificationLogChannel" AS ENUM (
  'MOBILE_PUSH',
  'WEBSOCKET',
  'EMAIL',
  'IN_APP',
  'UNKNOWN'
);

-- CreateEnum
CREATE TYPE "non_zero"."NotificationLogProvider" AS ENUM (
  'FCM',
  'APNS',
  'INTERNAL',
  'UNKNOWN'
);

-- CreateTable
CREATE TABLE "non_zero"."notification_log_events" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "notificationId" TEXT,
    "correlationId" TEXT NOT NULL,
    "eventType" "non_zero"."NotificationLogEventType" NOT NULL,
    "channel" "non_zero"."NotificationLogChannel" NOT NULL,
    "provider" "non_zero"."NotificationLogProvider",
    "status" "non_zero"."NotificationLogStatus" NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "reasonCode" TEXT,
    "metadata" JSONB,
    "idempotencyKey" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_log_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notification_log_events_workspaceId_idempotencyKey_key" ON "non_zero"."notification_log_events"("workspaceId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "notification_log_events_workspaceId_notificationId_occurredA_idx" ON "non_zero"."notification_log_events"("workspaceId", "notificationId", "occurredAt");

-- CreateIndex
CREATE INDEX "notification_log_events_workspaceId_correlationId_occurredAt_idx" ON "non_zero"."notification_log_events"("workspaceId", "correlationId", "occurredAt");

-- CreateIndex
CREATE INDEX "notification_log_events_workspaceId_eventType_occurredAt_idx" ON "non_zero"."notification_log_events"("workspaceId", "eventType", "occurredAt");

-- CreateIndex
CREATE INDEX "notification_log_events_workspaceId_channel_provider_occurre_idx" ON "non_zero"."notification_log_events"("workspaceId", "channel", "provider", "occurredAt");
