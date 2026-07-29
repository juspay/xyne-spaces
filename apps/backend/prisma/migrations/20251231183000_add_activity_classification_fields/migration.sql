-- Add ActivityClassification enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ActivityClassification') THEN
    CREATE TYPE "ActivityClassification" AS ENUM ('ACTIONABLE', 'FYI', 'SKIP', 'PENDING', 'PROCESSING', 'ERROR');
  END IF;
END $$;

-- Add ActivityClassificationJobType enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ActivityClassificationJobType') THEN
    CREATE TYPE "ActivityClassificationJobType" AS ENUM ('SINGLE', 'SPECIAL_MENTION_AUDIENCE');
  END IF;
END $$;

-- Add classification columns to activities
ALTER TABLE "activities"
  ADD COLUMN IF NOT EXISTS "classification" "ActivityClassification" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS "classificationConfidence" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "classificationAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "classificationJobType" "ActivityClassificationJobType";

-- Indexes for classification queries
CREATE INDEX IF NOT EXISTS "activities_user_classification_created_idx"
  ON "activities" ("userId", "classification", "createdAt");

CREATE INDEX IF NOT EXISTS "activities_classification_jobtype_created_idx"
  ON "activities" ("classification", "classificationJobType", "createdAt");

CREATE INDEX IF NOT EXISTS "activities_classification_jobtype_actionsource_channel_idx"
  ON "activities" ("classificationJobType", "actionSourceId", "channelId", "classification");
