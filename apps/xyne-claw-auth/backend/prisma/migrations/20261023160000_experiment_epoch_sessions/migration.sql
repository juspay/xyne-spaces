-- AlterTable
ALTER TABLE "experiment_runs" ADD COLUMN IF NOT EXISTS "epochSessionIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
