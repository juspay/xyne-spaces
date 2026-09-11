-- AlterTable
ALTER TABLE "public"."workflow_executions" ADD COLUMN     "entityType" TEXT,
ADD COLUMN     "entityId" TEXT;

-- CreateIndex
CREATE INDEX "workflow_executions_entityType_entityId_createdAt_idx" ON "public"."workflow_executions"("entityType", "entityId", "createdAt" DESC);
