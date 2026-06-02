-- Subsystem-aware memory pipeline: each candidate now targets a SUBSYSTEM
-- (discovered from Hindsight tags, never hardcoded). Adds four columns to
-- pending_memory_reviews so the approve flow can do retain-then-delete swaps
-- safely and admin can spot brand-new subsystem proposals.
ALTER TABLE "pending_memory_reviews"
  ADD COLUMN IF NOT EXISTS "subsystem"        TEXT,
  ADD COLUMN IF NOT EXISTS "action"           TEXT,
  ADD COLUMN IF NOT EXISTS "replacesMemoryId" TEXT,
  ADD COLUMN IF NOT EXISTS "isNewSubsystem"   BOOLEAN NOT NULL DEFAULT FALSE;
