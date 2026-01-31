-- AlterTable
ALTER TABLE "workflows" ALTER COLUMN "ticketId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "workflow_execution_users" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workflowExecutionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_execution_users_pkey" PRIMARY KEY ("id") s
);

-- CreateIndex
CREATE INDEX "workflow_execution_users_userId_idx" ON "workflow_execution_users"("userId");

-- CreateIndex
CREATE INDEX "workflow_execution_users_workflowExecutionId_idx" ON "workflow_execution_users"("workflowExecutionId");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_execution_users_userId_workflowExecutionId_key" ON "workflow_execution_users"("userId", "workflowExecutionId"); 
