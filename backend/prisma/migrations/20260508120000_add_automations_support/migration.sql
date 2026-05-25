-- CreateEnum
CREATE TYPE "public"."WorkflowEventType" AS ENUM ('NO_OP', 'TICKET_CREATED', 'TICKET_UPDATED', 'TICKET_COMMENTED', 'EMAIL_RECEIVED', 'EMAIL_SENT');

-- AlterTable
ALTER TABLE "public"."workflows" ADD COLUMN "eventType" "public"."WorkflowEventType" NOT NULL DEFAULT 'NO_OP';

-- CreateIndex
CREATE INDEX "workflows_eventType_status_idx" ON "public"."workflows"("eventType", "status");

-- CreateIndex
CREATE INDEX "workflows_workflowType_createdAt_id_idx" ON "public"."workflows"("workflowType", "createdAt" DESC, "id");

-- CreateIndex
CREATE INDEX "workflow_executions_workflowId_createdAt_id_idx" ON "public"."workflow_executions"("workflowId", "createdAt" DESC, "id");
