-- agent_runs (completedAt, triggerSource) index.
--
-- Every workspace-metrics window query filters on a bare completedAt range
-- (no leading equality column), which none of the existing composite indexes
-- can serve — each dashboard load seq-scanned agent_runs 8x, scaling with
-- table size instead of window size. triggerSource as the second column also
-- covers the new byTrigger / perDayTrigger groupings.
--
-- ⚠ PROD APPLY NOTE: migrations are applied MANUALLY in SQL studio (no
-- _prisma_migrations baseline). Plain CREATE INDEX takes a write lock on
-- agent_runs for the build duration — on the live table, run the CONCURRENTLY
-- variant instead (it cannot run inside a transaction; execute as a single
-- standalone statement):
--
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS
--     "agent_runs_completedAt_triggerSource_idx"
--     ON "agent_runs" ("completedAt", "triggerSource");
--
-- The non-concurrent statement below is for fresh/dev databases where
-- `prisma migrate` runs this file inside a transaction (CONCURRENTLY is
-- illegal there). Both are guarded — IF NOT EXISTS makes a re-run a no-op
-- either way, and the index name matches what Prisma derives from
-- @@index([completedAt, triggerSource]) so drift checks stay clean.

CREATE INDEX IF NOT EXISTS "agent_runs_completedAt_triggerSource_idx"
  ON "agent_runs" ("completedAt", "triggerSource");
