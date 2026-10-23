-- AlterTable
ALTER TABLE "experiment_runs" ADD COLUMN IF NOT EXISTS "commandId" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "loop_command_definitions" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "instruction" TEXT NOT NULL,
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "subagents" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "provider" TEXT,
    "modelId" TEXT,
    "maxDurationMinutes" INTEGER NOT NULL,
    "maxPasses" INTEGER,
    "deliverable" TEXT,
    "judgeQuestion" TEXT,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "loop_command_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "loop_command_definitions_orgId_name_key" ON "loop_command_definitions"("orgId", "name");
CREATE INDEX IF NOT EXISTS "loop_command_definitions_orgId_published_idx" ON "loop_command_definitions"("orgId", "published");
