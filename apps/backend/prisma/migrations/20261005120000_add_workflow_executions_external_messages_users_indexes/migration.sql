-- CreateIndex
CREATE INDEX CONCURRENTLY IF NOT EXISTS "workflow_executions_status_workflowType_createdAt_idx"
  ON "workflow"."workflow_executions" ("status", "workflowType", "createdAt");

-- CreateIndex
CREATE INDEX CONCURRENTLY IF NOT EXISTS "external_messages_externalId_idx"
  ON "workflow"."external_messages" ("externalId");

-- CreateIndex
CREATE INDEX CONCURRENTLY IF NOT EXISTS "users_orgMemberId_idx"
  ON "public"."users" ("orgMemberId");
