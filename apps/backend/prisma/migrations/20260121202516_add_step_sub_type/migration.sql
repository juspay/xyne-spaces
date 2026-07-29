-- AlterTable
ALTER TABLE "workflow_steps" ADD COLUMN "stepSubType" TEXT;

-- CreateIndex
CREATE INDEX "workflow_steps_stepSubType_idx" ON "workflow_steps"("stepSubType");
