-- Wipe the memory pipeline's HITL state. Run BEFORE the curator rollout so
-- pre-curator garbage doesn't mix with curator candidates. Safe to run on
-- prod claw-auth-postgres — does NOT touch Hindsight's DB.
--
-- After this:
--   * No pending batches / memory candidates
--   * No recall-hit history
--   * Memory toggled OFF for every agent — re-enable only on the pilot
--     (Product Ideas) once the curator is deployed.

BEGIN;

-- 1. Drop all HITL state.
TRUNCATE TABLE pending_batch_reviews   RESTART IDENTITY CASCADE;
TRUNCATE TABLE pending_memory_reviews  RESTART IDENTITY CASCADE;
TRUNCATE TABLE memory_recall_hits      RESTART IDENTITY CASCADE;

-- 2. Disable memory on every agent. Re-enable per-agent via
--    POST /memory/banks/:agentSlug/enable once the curator is live and you're
--    ready to pilot.
UPDATE agents
SET    config = jsonb_set(coalesce(config, '{}'::jsonb), '{memoryEnabled}', 'false')
WHERE  config->>'memoryEnabled' = 'true';

COMMIT;
