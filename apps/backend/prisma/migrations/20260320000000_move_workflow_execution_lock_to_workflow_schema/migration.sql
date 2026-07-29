CREATE TABLE "workflow"."workflow_execution_locks" (
    "id" TEXT NOT NULL,
    "workflowExecutionId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "expiry" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_execution_locks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "workflow_execution_locks_workflowExecutionId_key"
    ON "workflow"."workflow_execution_locks"("workflowExecutionId");
