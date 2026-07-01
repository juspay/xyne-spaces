-- AlterTable
ALTER TABLE "public"."user_preferences" ALTER COLUMN "globalDesktopNotificationLevel" DROP NOT NULL,
ALTER COLUMN "globalDesktopNotificationLevel" DROP DEFAULT,
ALTER COLUMN "globalMobileNotificationLevel" DROP NOT NULL,
ALTER COLUMN "globalMobileNotificationLevel" DROP DEFAULT;
