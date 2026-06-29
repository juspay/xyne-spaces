-- AlterTable
ALTER TABLE "public"."email_channel_preferences" ADD COLUMN     "twoStepSendEnabled" BOOLEAN NOT NULL DEFAULT false;
