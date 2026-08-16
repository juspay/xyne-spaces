-- AlterTable
ALTER TABLE "workflow"."workflow_steps" ADD COLUMN     "entityType" TEXT,
ADD COLUMN     "entityId" TEXT;

-- CreateIndex
CREATE INDEX "workflow_steps_entityType_entityId_idx" ON "workflow"."workflow_steps"("entityType", "entityId");
