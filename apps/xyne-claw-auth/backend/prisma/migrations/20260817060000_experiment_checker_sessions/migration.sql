-- In-flight checker sessions, so `/experiment stop` can cancel them too.
-- Checkers never claim currentSessionId (that would chain the next epoch off
-- their completion), which left them unreachable by stop.
ALTER TABLE "experiment_runs"
  ADD COLUMN "checkerSessionIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
