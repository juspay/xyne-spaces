-- AlterTable
ALTER TABLE "workflow"."workflow_credentials"
  ADD COLUMN "ownerId" TEXT,
  ADD COLUMN "allowedWorkflowIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
