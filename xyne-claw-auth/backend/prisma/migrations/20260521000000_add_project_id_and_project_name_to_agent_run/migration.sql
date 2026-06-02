-- AlterTable: add projectId and projectName columns to agent_runs
-- Both are nullable so existing rows are unaffected.
ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "projectId" TEXT;
ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "projectName" TEXT;
