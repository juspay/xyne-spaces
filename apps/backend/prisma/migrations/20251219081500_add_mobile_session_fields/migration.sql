-- Add device identifiers and FCM token storage to user sessions
ALTER TABLE "user_sessions"
  ADD COLUMN "deviceId" TEXT NULL,
  ADD COLUMN "fcmToken" TEXT NULL;

ALTER TYPE "NotificationDeliveryMethod" ADD VALUE 'MOBILE';
