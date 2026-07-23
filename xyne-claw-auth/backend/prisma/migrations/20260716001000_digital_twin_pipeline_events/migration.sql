-- Digital Twin pipeline observability.
--
-- One row per curator invocation (backfill window, daily source, upload, or
-- twin-approval) so the pipeline viewer can show the LLM exchange, the records
-- fed in, and per-run counts without re-running anything. Written best-effort
-- and pruned to a rolling 30-day window.
--
-- Manual/studio apply safe: guarded with IF NOT EXISTS in case the table was
-- created by hand during rollout. Matches prisma/schema.prisma's
-- DigitalTwinPipelineEvent model exactly.

CREATE TABLE IF NOT EXISTS "digital_twin_pipeline_events" (
  "id"                  TEXT         NOT NULL,
  "userId"              TEXT         NOT NULL,
  "runType"             TEXT         NOT NULL,
  "source"              TEXT         NOT NULL,
  "sourceKind"          TEXT,
  "windowFrom"          TIMESTAMP(3) NOT NULL,
  "windowTo"            TIMESTAMP(3) NOT NULL,
  "status"              TEXT         NOT NULL,
  "recordCount"         INTEGER      NOT NULL DEFAULT 0,
  "records"             JSONB,
  "existingMemoryCount" INTEGER      NOT NULL DEFAULT 0,
  "emittedCount"        INTEGER      NOT NULL DEFAULT 0,
  "keptCount"           INTEGER      NOT NULL DEFAULT 0,
  "candidatesCreated"   INTEGER      NOT NULL DEFAULT 0,
  "autoApproved"        INTEGER      NOT NULL DEFAULT 0,
  "durationMs"          INTEGER      NOT NULL DEFAULT 0,
  "error"               TEXT,
  "trace"               JSONB,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "digital_twin_pipeline_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "digital_twin_pipeline_events_userId_createdAt_idx"
  ON "digital_twin_pipeline_events" ("userId", "createdAt");

CREATE INDEX IF NOT EXISTS "digital_twin_pipeline_events_userId_runType_createdAt_idx"
  ON "digital_twin_pipeline_events" ("userId", "runType", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'digital_twin_pipeline_events_userId_fkey'
  ) THEN
    ALTER TABLE "digital_twin_pipeline_events"
      ADD CONSTRAINT "digital_twin_pipeline_events_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;
