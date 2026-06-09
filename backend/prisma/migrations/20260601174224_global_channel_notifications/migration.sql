-- AlterTable
ALTER TABLE "public"."channel_user_status" ADD COLUMN     "channelWideMentionsEnabled" BOOLEAN,
ADD COLUMN     "threadReplyNotificationsEnabled" BOOLEAN,
ALTER COLUMN "desktopNotificationLevel" DROP NOT NULL,
ALTER COLUMN "desktopNotificationLevel" DROP DEFAULT,
ALTER COLUMN "mobileNotificationLevel" DROP NOT NULL,
ALTER COLUMN "mobileNotificationLevel" DROP DEFAULT;

-- AlterTable
ALTER TABLE "public"."user_preferences" ADD COLUMN     "channelWideMentionsEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "globalDesktopNotificationLevel" "public"."NotificationLevel" NOT NULL DEFAULT 'MENTIONS_ONLY',
ADD COLUMN     "globalMobileNotificationLevel" "public"."NotificationLevel" NOT NULL DEFAULT 'MENTIONS_ONLY',
ADD COLUMN     "threadReplyNotificationsEnabled" BOOLEAN NOT NULL DEFAULT true;
