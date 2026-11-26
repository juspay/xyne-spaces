-- AlterTable
ALTER TABLE "public"."workflows" ADD COLUMN "version" INTEGER;

-- AlterTable
ALTER TABLE "workflow"."workflow_executions" ADD COLUMN "workflowVersion" INTEGER;
