-- CreateEnum
CREATE TYPE "public"."NotificationLevel" AS ENUM ('ALL', 'MENTIONS_ONLY', 'THREADS_ONLY', 'NONE');

-- AlterTable
ALTER TABLE "public"."channel_user_status" ADD COLUMN     "desktopNotificationLevel" "public"."NotificationLevel" NOT NULL DEFAULT 'ALL',
ADD COLUMN     "mobileNotificationLevel" "public"."NotificationLevel" NOT NULL DEFAULT 'ALL';

-- AlterTable
ALTER TABLE "public"."user_presence" ADD COLUMN     "notificationsPausedUntil" TIMESTAMP(3);
