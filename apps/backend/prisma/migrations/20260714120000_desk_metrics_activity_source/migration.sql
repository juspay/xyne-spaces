ALTER TYPE "public"."ActivityType" ADD VALUE 'EMAIL_SENT';
ALTER TYPE "public"."ActivityType" ADD VALUE 'TICKET_CREATED';
ALTER TYPE "public"."ActivityType" ADD VALUE 'CSAT_RECEIVED';

ALTER TABLE "public"."ticket_activities" ADD COLUMN IF NOT EXISTS "channelId" TEXT;

ALTER TABLE "public"."email_channel_preferences"
  ADD COLUMN IF NOT EXISTS "metricsEnabled" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "frtStageNames" TEXT;
