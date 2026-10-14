-- Per-user default summary template for recordings.
ALTER TABLE "public"."user_preferences" ADD COLUMN "recordingDefaultSummaryTemplateId" TEXT;
