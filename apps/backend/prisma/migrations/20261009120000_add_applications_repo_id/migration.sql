-- repoId stays nullable: rows written before it existed get it from the release-config
-- backfill, and the code sets it on every save. repoUrl keeps its NOT NULL and gets an
-- empty default, so the code can stop writing it; nothing reads it any more.
-- AlterTable
ALTER TABLE "public"."applications" ADD COLUMN     "repoId" TEXT,
ALTER COLUMN "repoUrl" SET DEFAULT '';

-- CreateIndex
CREATE INDEX "applications_repoId_idx" ON "public"."applications"("repoId");
