-- AlterTable
ALTER TABLE "artifact_apps" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);
