-- CreateTable
CREATE TABLE "workflow"."workflow_execution_states" (
    "id" TEXT NOT NULL,
    "workflowExecutionId" TEXT NOT NULL,
    "context" TEXT,
    "output" TEXT,

    CONSTRAINT "workflow_execution_states_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workflow_execution_states_workflowExecutionId_key" ON "workflow"."workflow_execution_states"("workflowExecutionId");

-- CreateIndex
CREATE INDEX "workflow_execution_states_workflowExecutionId_idx" ON "workflow"."workflow_execution_states"("workflowExecutionId");
