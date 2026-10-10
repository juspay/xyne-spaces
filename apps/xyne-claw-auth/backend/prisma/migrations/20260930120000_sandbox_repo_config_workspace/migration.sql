-- AlterTable
ALTER TABLE "sandbox_repo_configs" ADD COLUMN     "createdByUserId" TEXT,
ADD COLUMN     "workspaceId" TEXT;

-- CreateIndex
CREATE INDEX "sandbox_repo_configs_workspaceId_idx" ON "sandbox_repo_configs"("workspaceId");

