-- @xyne/workflow-sdk (v2 workflow engine, /api/workflow-studio, src/workflowSdk).
--
-- The SDK's workflows / executions / execution-states / step-records REUSE the
-- existing tables (workflows, workflow_executions, workflow_execution_states,
-- workflow_steps), discriminated by workflowType='SDK'. This migration adds the
-- columns those tables were missing (all nullable — instant, no table rewrite)
-- and creates only the stores that have no existing counterpart.
--
-- Every new table carries the denormalized `workspaceId` tenant key, so the
-- tenant extension (src/database/tenant/acl-extension.ts) scopes them without a
-- hand-written ACL class. The value is stamped on insert from the owning
-- workflow/execution (src/workflowSdk/persistence.ts) and is immutable.

-- AlterTable: v2 workflow-sdk columns (null on legacy/automation rows)
ALTER TABLE "public"."workflows"
  ADD COLUMN "folderId" TEXT,
  ADD COLUMN "isPublic" BOOLEAN,
  ADD COLUMN "summary" TEXT,
  -- The SDK's trigger type (MANUAL/CRON/WEBHOOK/...). Kept out of `eventType`,
  -- which is a closed validated enum driving the automations event router —
  -- SDK rows leave that at NO_OP so the router skips them.
  ADD COLUMN "sdkEventType" TEXT;

CREATE INDEX "workflows_workspaceId_sdkEventType_status_idx"
  ON "public"."workflows"("workspaceId", "sdkEventType", "status");

ALTER TABLE "public"."workflow_executions"
  ADD COLUMN "sourceExecutionId" TEXT;

ALTER TABLE "workflow"."workflow_execution_states"
  ADD COLUMN "pausePath" TEXT,
  ADD COLUMN "pauseType" TEXT;

-- CreateTable: stores with no existing counterpart. Bare names inside the
-- dedicated `workflow` schema, matching the SDK's reference layout.
CREATE TABLE "workflow"."sdk_folders" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "metadata" TEXT,
    "parentId" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" BIGINT NOT NULL,

    CONSTRAINT "sdk_folders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workflow"."sdk_step_events" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "stepName" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "createdAt" BIGINT NOT NULL,

    CONSTRAINT "sdk_step_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workflow"."sdk_static_data" (
    "workspaceId" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB,
    "updatedAt" BIGINT NOT NULL,

    CONSTRAINT "sdk_static_data_pkey" PRIMARY KEY ("workflowId","key")
);

-- `data` holds AES-encrypted credential material (encrypted by the adapter).
CREATE TABLE "workflow"."sdk_credentials" (
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "credType" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" BIGINT NOT NULL,
    "updatedAt" BIGINT NOT NULL,

    CONSTRAINT "sdk_credentials_pkey" PRIMARY KEY ("workspaceId","name")
);

CREATE TABLE "workflow"."sdk_webhooks" (
    "workflowId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "createdAt" BIGINT NOT NULL,

    CONSTRAINT "sdk_webhooks_pkey" PRIMARY KEY ("workflowId")
);

CREATE TABLE "workflow"."sdk_resume_payloads" (
    "executionId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "createdAt" BIGINT NOT NULL,

    CONSTRAINT "sdk_resume_payloads_pkey" PRIMARY KEY ("executionId")
);

CREATE TABLE "workflow"."sdk_workflow_callbacks" (
    "workflowId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "createdAt" BIGINT NOT NULL,

    CONSTRAINT "sdk_workflow_callbacks_pkey" PRIMARY KEY ("workflowId")
);

-- Polymorphic per-user grants on sdk resources. Lives in `public` (alongside
-- users), so it keeps the sdk_ prefix to stay self-describing there.
CREATE TABLE "public"."sdk_resource_permissions" (
    "id" SERIAL NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'viewer',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sdk_resource_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sdk_folders_workspaceId_idx" ON "workflow"."sdk_folders"("workspaceId");

CREATE INDEX "sdk_step_events_executionId_stepName_createdAt_idx"
  ON "workflow"."sdk_step_events"("executionId", "stepName", "createdAt");

CREATE INDEX "sdk_step_events_workspaceId_idx" ON "workflow"."sdk_step_events"("workspaceId");

CREATE INDEX "sdk_static_data_workspaceId_idx" ON "workflow"."sdk_static_data"("workspaceId");

CREATE UNIQUE INDEX "sdk_webhooks_path_unique" ON "workflow"."sdk_webhooks"("path");

CREATE INDEX "sdk_webhooks_workspaceId_idx" ON "workflow"."sdk_webhooks"("workspaceId");

CREATE INDEX "sdk_resume_payloads_workspaceId_idx"
  ON "workflow"."sdk_resume_payloads"("workspaceId");

CREATE UNIQUE INDEX "sdk_workflow_callbacks_secret_unique"
  ON "workflow"."sdk_workflow_callbacks"("secret");

CREATE INDEX "sdk_workflow_callbacks_workspaceId_idx"
  ON "workflow"."sdk_workflow_callbacks"("workspaceId");

CREATE INDEX "sdk_resource_permissions_resourceType_resourceId_idx"
  ON "public"."sdk_resource_permissions"("resourceType", "resourceId");

CREATE INDEX "sdk_resource_permissions_userId_idx"
  ON "public"."sdk_resource_permissions"("userId");

CREATE INDEX "sdk_resource_permissions_workspaceId_idx"
  ON "public"."sdk_resource_permissions"("workspaceId");

CREATE UNIQUE INDEX "sdk_resource_permissions_userId_resourceType_resourceId_key"
  ON "public"."sdk_resource_permissions"("userId", "resourceType", "resourceId");

-- Feature-gate resource for the v2 engine (src/workflowSdk/accessControl.ts).
-- Deliberately distinct from the legacy WORKFLOWS resource so the two engines'
-- grants stay independent. Idempotent: `name` is unique, and re-running the
-- migration on a database that already has the row must not fail.
INSERT INTO "public"."resources" ("id", "name", "description", "createdAt", "updatedAt")
VALUES (
  gen_random_uuid()::text,
  'WORKFLOW-STUDIO',
  'Workflow Studio (@xyne/workflow-sdk) — /api/workflow-studio and the /workflow-studio UI',
  NOW(),
  NOW()
)
ON CONFLICT ("name") DO NOTHING;
