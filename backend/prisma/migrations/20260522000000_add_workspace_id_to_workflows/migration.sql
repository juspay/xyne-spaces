-- AlterTable
ALTER TABLE "public"."workflows" ADD COLUMN     "workspaceId" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "workflows_workspaceId_eventType_status_idx" ON "public"."workflows"("workspaceId", "eventType", "status");

-- CreateIndex
CREATE INDEX "workflows_workspaceId_workflowType_createdAt_idx" ON "public"."workflows"("workspaceId", "workflowType", "createdAt" DESC);

