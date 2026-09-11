-- AlterTable: add desk-report scheduling preferences to email_channel_preferences
ALTER TABLE "public"."email_channel_preferences"
  ADD COLUMN "deskReportEnabled" BOOLEAN DEFAULT false,
  ADD COLUMN "deskReportAgentSlug" TEXT,
  ADD COLUMN "deskReportRangeDays" INTEGER DEFAULT 1;
