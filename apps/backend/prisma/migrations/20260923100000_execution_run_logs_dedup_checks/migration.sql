-- AlterTable
-- What the Jev duplicate check decided on each parse: every create it scored,
-- the open item it matched best, the score, and — when the parser was sent
-- back — what the parser did with the create. Read only by the debug panel.
ALTER TABLE "non_zero"."execution_run_logs" ADD COLUMN "dedupChecks" JSONB;
