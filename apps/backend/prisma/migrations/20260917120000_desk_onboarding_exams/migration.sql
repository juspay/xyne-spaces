-- AlterTable: desk onboarding exams. Both columns are read and written over REST only and are
-- deliberately absent from the Zero schema, so replies and grader reasoning never sync to clients.
ALTER TABLE "public"."email_channel_preferences"
  ADD COLUMN "onboardingConfig" JSONB,
  ADD COLUMN "onboardingAttempts" JSONB;
