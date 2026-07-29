-- Curator pipeline changes to pending_memory_reviews:
--   1. hindsightMemoryId becomes NULL until the candidate is approved
--      (curator writes the row BEFORE Hindsight retain; retain happens on approve).
--   2. Add sessionId column for audit + tagging when retain finally fires.
ALTER TABLE "pending_memory_reviews"
  ALTER COLUMN "hindsightMemoryId" DROP NOT NULL;

ALTER TABLE "pending_memory_reviews"
  ADD COLUMN IF NOT EXISTS "sessionId" TEXT;
