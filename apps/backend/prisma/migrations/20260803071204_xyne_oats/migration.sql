-- AlterEnum
ALTER TYPE "public"."NotificationType" ADD VALUE 'RECORDING_SHARED';

-- AlterTable
ALTER TABLE "public"."calls" ADD COLUMN     "labels" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "markedItems" JSONB[] DEFAULT ARRAY[]::JSONB[],
ADD COLUMN     "summaryTemplateId" TEXT;

-- CreateTable
CREATE TABLE "public"."entity_access" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "shareableEntityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "userId" TEXT,
    "userGroupId" TEXT,
    "channelId" TEXT,
    "entityUserAccess" TEXT NOT NULL DEFAULT 'VIEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "entity_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."summary_templates" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "autoTriggerPrompt" TEXT,
    "sections" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "systemPrompt" TEXT NOT NULL,
    "defaultOutlet" TEXT NOT NULL DEFAULT 'EMAIL',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "summary_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "entity_access_workspaceId_shareableEntityType_entityId_idx" ON "public"."entity_access"("workspaceId", "shareableEntityType", "entityId");

-- CreateIndex
CREATE INDEX "entity_access_workspaceId_userId_idx" ON "public"."entity_access"("workspaceId", "userId");

-- CreateIndex
CREATE INDEX "entity_access_workspaceId_userGroupId_idx" ON "public"."entity_access"("workspaceId", "userGroupId");

-- CreateIndex
CREATE INDEX "entity_access_workspaceId_channelId_idx" ON "public"."entity_access"("workspaceId", "channelId");

-- CreateIndex
CREATE UNIQUE INDEX "entity_access_workspaceId_shareableEntityType_entityId_user_key" ON "public"."entity_access"("workspaceId", "shareableEntityType", "entityId", "userId");

-- CreateIndex
CREATE INDEX "summary_templates_workspaceId_name_idx" ON "public"."summary_templates"("workspaceId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "summary_templates_workspaceId_name_version_key" ON "public"."summary_templates"("workspaceId", "name", "version");

-- CreateIndex
CREATE INDEX "calls_summaryTemplateId_idx" ON "public"."calls"("summaryTemplateId");
