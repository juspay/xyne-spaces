-- Add priority classification fields used by ticket ingest and channel settings.
ALTER TABLE "public"."email_channel_preferences"
  ADD COLUMN IF NOT EXISTS "priorityClassificationEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "priorityClassificationPrompt" TEXT,
  ADD COLUMN IF NOT EXISTS "priorityClassificationThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.5;

ALTER TABLE "public"."tickets"
  ADD COLUMN IF NOT EXISTS "aiPriority" TEXT;

CREATE INDEX IF NOT EXISTS "tickets_aiPriority_idx" ON "public"."tickets"("aiPriority");
CREATE INDEX IF NOT EXISTS "email_channel_preferences_priorityClassificationEnabled_idx"
  ON "public"."email_channel_preferences"("priorityClassificationEnabled");

-- Preserve deterministic field ordering for existing forms and new edits.
ALTER TABLE "public"."form_fields"
  ADD COLUMN IF NOT EXISTS "sequenceNumber" INTEGER NOT NULL DEFAULT 0;

-- Existing rows are backfilled via the admin migration API:
-- POST /migrate/api/admin/form-field-sequence-backfill

CREATE INDEX IF NOT EXISTS "form_fields_formId_sequenceNumber_idx"
  ON "public"."form_fields"("formId", "sequenceNumber");

-- Add attachmentIds column to email_drafts for storing draft attachment references.
ALTER TABLE "email_drafts" ADD COLUMN IF NOT EXISTS "attachmentIds" JSONB;
