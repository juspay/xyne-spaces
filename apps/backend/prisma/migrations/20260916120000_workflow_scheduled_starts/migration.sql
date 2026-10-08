ALTER TABLE "workflow"."workflow_execution_states"
  ADD COLUMN IF NOT EXISTS "fireAt"    TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "origin"    TEXT,
  ADD COLUMN IF NOT EXISTS "endReason" TEXT;

CREATE INDEX IF NOT EXISTS "workflow_execution_states_fireAt_idx"
  ON "workflow"."workflow_execution_states" ("fireAt");
