-- AlterTable: extra inbound addresses (aliases) that route into the same DL desk
ALTER TABLE "public"."email_channel_preferences"
  ADD COLUMN "dlAliases" TEXT;
