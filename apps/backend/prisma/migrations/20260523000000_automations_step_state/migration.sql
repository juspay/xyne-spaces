-- AlterTable
ALTER TABLE "workflow"."workflow_execution_states" ADD COLUMN     "currentStepIndex" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "workflow_steps_workflowExecutionId_stepName_key" ON "workflow"."workflow_steps"("workflowExecutionId", "stepName");

