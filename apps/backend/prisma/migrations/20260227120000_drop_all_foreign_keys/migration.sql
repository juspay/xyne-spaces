-- Drop all foreign key constraints in preparation for relationMode = "prisma"
-- After this migration, referential integrity is enforced at the Prisma client level.

-- agents
ALTER TABLE "agents" DROP CONSTRAINT IF EXISTS "agents_modelId_fkey";

-- agent_tools_mappings
ALTER TABLE "agent_tools_mappings" DROP CONSTRAINT IF EXISTS "agent_tools_mappings_agentId_fkey";
ALTER TABLE "agent_tools_mappings" DROP CONSTRAINT IF EXISTS "agent_tools_mappings_toolId_fkey";

-- agent_steps
ALTER TABLE "agent_steps" DROP CONSTRAINT IF EXISTS "agent_steps_agentId_fkey";

-- workflow_executions
ALTER TABLE "workflow_executions" DROP CONSTRAINT IF EXISTS "workflow_executions_workflowId_fkey";
ALTER TABLE "workflow_executions" DROP CONSTRAINT IF EXISTS "workflow_executions_parentWorkflowExecutionId_fkey";

-- workflow_execution_locks
ALTER TABLE "workflow_execution_locks" DROP CONSTRAINT IF EXISTS "workflow_execution_locks_workflowExecutionId_fkey";

-- workflow_steps (in workflow schema)
ALTER TABLE "workflow_steps" DROP CONSTRAINT IF EXISTS "workflow_steps_workflowExecutionId_fkey";

-- external_step_responses
ALTER TABLE "external_step_responses" DROP CONSTRAINT IF EXISTS "external_step_responses_workflowExecutionId_fkey";
ALTER TABLE "external_step_responses" DROP CONSTRAINT IF EXISTS "external_step_responses_workflowStepId_fkey";

-- api_keys
ALTER TABLE "api_keys" DROP CONSTRAINT IF EXISTS "api_keys_userId_fkey";

-- user_sessions
ALTER TABLE "user_sessions" DROP CONSTRAINT IF EXISTS "user_sessions_userId_fkey";

-- user_presence
ALTER TABLE "user_presence" DROP CONSTRAINT IF EXISTS "user_presence_userId_fkey";

-- resource_access
ALTER TABLE "resource_access" DROP CONSTRAINT IF EXISTS "resource_access_groupId_fkey";
ALTER TABLE "resource_access" DROP CONSTRAINT IF EXISTS "resource_access_userId_fkey";
ALTER TABLE "resource_access" DROP CONSTRAINT IF EXISTS "resource_access_resourceId_fkey";

-- acl_audit_logs
ALTER TABLE "acl_audit_logs" DROP CONSTRAINT IF EXISTS "acl_audit_logs_actorUserId_fkey";

-- message_search
ALTER TABLE "message_search" DROP CONSTRAINT IF EXISTS "message_search_messageId_fkey";

-- Create indexes on FK columns that previously relied on auto-created DB indexes from FK constraints

-- agents
CREATE INDEX IF NOT EXISTS "agents_modelId_idx" ON "agents"("modelId");

-- agent_steps
CREATE INDEX IF NOT EXISTS "agent_steps_agentId_idx" ON "agent_steps"("agentId");

-- api_keys
CREATE INDEX IF NOT EXISTS "api_keys_userId_idx" ON "api_keys"("userId");

-- channels
CREATE INDEX IF NOT EXISTS "channels_projectId_idx" ON "channels"("projectId");

-- external_step_responses
CREATE INDEX IF NOT EXISTS "external_step_responses_workflowExecutionId_idx" ON "external_step_responses"("workflowExecutionId");

-- ticket_activities
CREATE INDEX IF NOT EXISTS "ticket_activities_updatedBy_idx" ON "ticket_activities"("updatedBy");

-- ticket_stage_eta
CREATE INDEX IF NOT EXISTS "ticket_stage_eta_stageId_idx" ON "ticket_stage_eta"("stageId");

-- workflows
CREATE INDEX IF NOT EXISTS "workflows_ticketId_idx" ON "workflows"("ticketId");

-- workflow_executions
CREATE INDEX IF NOT EXISTS "workflow_executions_workflowId_idx" ON "workflow_executions"("workflowId");

-- workflow_steps (in workflow schema)
CREATE INDEX IF NOT EXISTS "workflow_steps_workflowExecutionId_idx" ON "workflow_steps"("workflowExecutionId");

-- agent_tools_mappings
CREATE INDEX IF NOT EXISTS "agent_tools_mappings_agentId_idx" ON "agent_tools_mappings"("agentId");
CREATE INDEX IF NOT EXISTS "agent_tools_mappings_toolId_idx" ON "agent_tools_mappings"("toolId");

-- tickets
CREATE INDEX IF NOT EXISTS "tickets_createdBy_idx" ON "tickets"("createdBy");
CREATE INDEX IF NOT EXISTS "tickets_updatedBy_idx" ON "tickets"("updatedBy");
CREATE INDEX IF NOT EXISTS "tickets_closedBy_idx" ON "tickets"("closedBy");
CREATE INDEX IF NOT EXISTS "tickets_conversationId_idx" ON "tickets"("conversationId");
CREATE INDEX IF NOT EXISTS "tickets_channelId_idx" ON "tickets"("channelId");

-- sub_tickets
CREATE INDEX IF NOT EXISTS "sub_tickets_createdBy_idx" ON "sub_tickets"("createdBy");
CREATE INDEX IF NOT EXISTS "sub_tickets_updatedBy_idx" ON "sub_tickets"("updatedBy");
CREATE INDEX IF NOT EXISTS "sub_tickets_assignedTo_idx" ON "sub_tickets"("assignedTo");
CREATE INDEX IF NOT EXISTS "sub_tickets_conversationId_idx" ON "sub_tickets"("conversationId");

-- workflow_executions
CREATE INDEX IF NOT EXISTS "workflow_executions_parentWorkflowExecutionId_idx" ON "workflow_executions"("parentWorkflowExecutionId");

-- user_group_mappings
CREATE INDEX IF NOT EXISTS "user_group_mappings_userId_idx" ON "user_group_mappings"("userId");
CREATE INDEX IF NOT EXISTS "user_group_mappings_userGroupId_idx" ON "user_group_mappings"("userGroupId");

-- user_assignment_states
CREATE INDEX IF NOT EXISTS "user_assignment_states_userId_idx" ON "user_assignment_states"("userId");

-- board_complexity_scores
CREATE INDEX IF NOT EXISTS "board_complexity_scores_boardId_idx" ON "board_complexity_scores"("boardId");

-- user_workload_mappings
CREATE INDEX IF NOT EXISTS "user_workload_mappings_userId_idx" ON "user_workload_mappings"("userId");
CREATE INDEX IF NOT EXISTS "user_workload_mappings_boardId_idx" ON "user_workload_mappings"("boardId");

-- user_expertise_mappings
CREATE INDEX IF NOT EXISTS "user_expertise_mappings_userId_idx" ON "user_expertise_mappings"("userId");
CREATE INDEX IF NOT EXISTS "user_expertise_mappings_boardId_idx" ON "user_expertise_mappings"("boardId");

-- resource_access
CREATE INDEX IF NOT EXISTS "resource_access_groupId_idx" ON "resource_access"("groupId");
CREATE INDEX IF NOT EXISTS "resource_access_userId_idx" ON "resource_access"("userId");
CREATE INDEX IF NOT EXISTS "resource_access_resourceId_idx" ON "resource_access"("resourceId");

-- channels
CREATE INDEX IF NOT EXISTS "channels_createdBy_idx" ON "channels"("createdBy");

-- conversations
CREATE INDEX IF NOT EXISTS "conversations_createdBy_idx" ON "conversations"("createdBy");

-- messages
CREATE INDEX IF NOT EXISTS "messages_senderId_idx" ON "messages"("senderId");

-- pull_requests
CREATE INDEX IF NOT EXISTS "pull_requests_workflowExecutionId_idx" ON "pull_requests"("workflowExecutionId");
