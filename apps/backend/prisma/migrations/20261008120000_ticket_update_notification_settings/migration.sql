-- AlterTable
ALTER TABLE "public"."conversation_participants" ADD COLUMN "ticketUpdatesUnsubscribedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "public"."user_preferences" ADD COLUMN "ticketUpdateNotificationsEnabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "public"."channel_user_status" ADD COLUMN "ticketUpdateNotificationsEnabled" BOOLEAN;
