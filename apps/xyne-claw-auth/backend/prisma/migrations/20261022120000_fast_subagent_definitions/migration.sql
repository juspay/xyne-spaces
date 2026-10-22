-- AlterTable
ALTER TABLE "subagent_definitions" ADD COLUMN IF NOT EXISTS "fast" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "subagent_definitions" ADD COLUMN IF NOT EXISTS "checks" JSONB;
ALTER TABLE "subagent_definitions" ADD COLUMN IF NOT EXISTS "checksVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "subagent_definitions" ADD COLUMN IF NOT EXISTS "samples" JSONB;
ALTER TABLE "subagent_definitions" ADD COLUMN IF NOT EXISTS "model" TEXT;
ALTER TABLE "subagent_definitions" ADD COLUMN IF NOT EXISTS "budget" JSONB;
