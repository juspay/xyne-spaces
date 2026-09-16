-- AlterTable
ALTER TABLE "public"."workflows" ADD COLUMN     "folderId" TEXT,
ADD COLUMN     "summary" TEXT;

-- AlterTable
ALTER TABLE "workflow"."workflow_execution_states" ADD COLUMN     "pausePath" TEXT,
ADD COLUMN     "pauseType" TEXT;

-- CreateTable
CREATE TABLE "workflow"."workflow_folders" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "metadata" TEXT,
    "parentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_folders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow"."workflow_credentials" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "credType" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workflow_folders_workspaceId_idx" ON "workflow"."workflow_folders"("workspaceId");

-- CreateIndex
CREATE INDEX "workflow_folders_workspaceId_parentId_idx" ON "workflow"."workflow_folders"("workspaceId", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_credentials_workspaceId_name_key" ON "workflow"."workflow_credentials"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "workflow_credentials_workspaceId_idx" ON "workflow"."workflow_credentials"("workspaceId");

