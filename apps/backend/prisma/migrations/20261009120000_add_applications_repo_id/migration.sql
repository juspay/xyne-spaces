-- repoId is added nullable so existing applications rows can be backfilled with their
-- repos.id; 20261009120050_require_applications_repo_id then makes it NOT NULL.
-- AlterTable
ALTER TABLE "public"."applications" ADD COLUMN     "repoId" TEXT,
ALTER COLUMN "repoUrl" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "applications_repoId_idx" ON "public"."applications"("repoId");
