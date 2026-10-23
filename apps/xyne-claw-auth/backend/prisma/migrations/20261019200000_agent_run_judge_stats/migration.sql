-- AlterTable
ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "judgeBackend" TEXT;
ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "judgeCalls" INTEGER;
ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "judgeFailed" INTEGER;
ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "compactionCalls" INTEGER;
