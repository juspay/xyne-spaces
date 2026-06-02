-- AlterEnum
ALTER TYPE "public"."WorkflowEventType" ADD VALUE 'WEBHOOK';

-- AlterEnum
ALTER TYPE "public"."WorkflowEventType" ADD VALUE 'MESSAGE_RECEIVED';

-- CreateEnum
CREATE TYPE "workflow"."WorkflowMappingEntityType" AS ENUM ('AUTOMATION_WEBHOOK');

-- CreateTable
CREATE TABLE "workflow"."workflow_mappings" (
    "id" TEXT NOT NULL,
    "entityType" "workflow"."WorkflowMappingEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "entitySecret" TEXT NOT NULL,

    CONSTRAINT "workflow_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workflow_mappings_entityType_idx" ON "workflow"."workflow_mappings"("entityType");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_mappings_entityType_entityId_key" ON "workflow"."workflow_mappings"("entityType", "entityId");
