-- AlterTable
ALTER TABLE "experiment_runs" ADD COLUMN IF NOT EXISTS "commandVersion" INTEGER;
ALTER TABLE "experiment_runs" ADD COLUMN IF NOT EXISTS "sequenceId" TEXT;
ALTER TABLE "experiment_runs" ADD COLUMN IF NOT EXISTS "sequenceStep" INTEGER;
ALTER TABLE "loop_command_definitions" ADD COLUMN IF NOT EXISTS "steps" JSONB;
ALTER TABLE "loop_command_definitions" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE IF NOT EXISTS "loop_command_versions" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "commandId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "loop_command_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "loop_sequence_runs" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "commandId" TEXT NOT NULL,
    "commandName" TEXT NOT NULL,
    "commandVersion" INTEGER NOT NULL,
    "conversationId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "agentSlug" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "focus" TEXT,
    "steps" JSONB NOT NULL,
    "stepIndex" INTEGER NOT NULL DEFAULT 0,
    "currentRunId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'running',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    CONSTRAINT "loop_sequence_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "loop_command_versions_commandId_version_key" ON "loop_command_versions"("commandId", "version");
CREATE INDEX IF NOT EXISTS "loop_command_versions_orgId_commandId_idx" ON "loop_command_versions"("orgId", "commandId");
CREATE INDEX IF NOT EXISTS "loop_sequence_runs_orgId_commandId_createdAt_idx" ON "loop_sequence_runs"("orgId", "commandId", "createdAt");
CREATE INDEX IF NOT EXISTS "loop_sequence_runs_conversationId_status_idx" ON "loop_sequence_runs"("conversationId", "status");
