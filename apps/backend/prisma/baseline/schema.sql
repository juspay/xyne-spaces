-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "non_zero";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "workflow";

-- CreateTable
CREATE TABLE "public"."agents" (
    "id" TEXT NOT NULL,
    "userDefinedId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "systemPrompt" TEXT NOT NULL,
    "description" TEXT,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "temp" DOUBLE PRECISION DEFAULT 0.7,
    "scope" TEXT NOT NULL DEFAULT 'project',
    "scopeURI" TEXT,

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."models" (
    "id" TEXT NOT NULL,
    "userDefinedId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "credentials" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."tools" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Enabled',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."agent_tools_mappings" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "toolId" TEXT NOT NULL,
    "specialDescription" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Enabled',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_tools_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."tickets" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "statusV2" TEXT NOT NULL DEFAULT 'TODO',
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "assignedTo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "statusUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "merchantId" TEXT,
    "conversationId" TEXT NOT NULL,
    "messageId" TEXT,
    "channelId" TEXT NOT NULL,
    "eta" TIMESTAMP(3),
    "firstRespondedAt" TIMESTAMP(3),
    "priority" TEXT NOT NULL DEFAULT 'LOW',
    "metadata" JSONB,
    "rootId" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedBy" TEXT,
    "referenceTicket" TEXT[],
    "xyneId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userGroupId" TEXT,
    "boardId" TEXT NOT NULL,
    "stageName" TEXT NOT NULL,
    "isStageOverdue" BOOLEAN,
    "ticketType" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "kanbanPosition" TEXT,
    "lastEmailAt" TIMESTAMP(3) NOT NULL,
    "emailCount" INTEGER,
    "classificationData" JSONB,
    "aiCategory" TEXT,
    "aiSubCategory" TEXT,
    "aiPriority" TEXT,
    "emailReplyEnabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ticket_descriptions" (
    "ticketId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ticket_descriptions_pkey" PRIMARY KEY ("ticketId")
);

-- CreateTable
CREATE TABLE "public"."sub_tickets" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "workspaceId" TEXT NOT NULL,
    "mappedTicketId" TEXT,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "conversationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "stageProgression" TEXT,
    "assignedTo" TEXT,

    CONSTRAINT "sub_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ticket_sub_ticket_mappings" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "subTicketId" TEXT NOT NULL,

    CONSTRAINT "ticket_sub_ticket_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ticket_assignments" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "userId" TEXT,
    "userResponsibility" TEXT,
    "roleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "ticket_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ticket_activities" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activityType" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "channelId" TEXT,

    CONSTRAINT "ticket_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ticket_entity_mappings" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityName" TEXT NOT NULL,

    CONSTRAINT "ticket_entity_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ticket_tags" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,

    CONSTRAINT "ticket_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."project_tags" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ticket_tag_mappings" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "tagName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_tag_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ticket_exports" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "filters" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ticket_exports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ticket_reference_mappings" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "sourceTicketId" TEXT NOT NULL,
    "targetTicketId" TEXT NOT NULL,
    "relationType" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ticket_reference_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ticket_stage_eta" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "version" INTEGER,
    "stageEnteredAt" TIMESTAMP(3) NOT NULL,
    "stageLeftAt" TIMESTAMP(3),
    "stageEta" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "updatedBy" TEXT,

    CONSTRAINT "ticket_stage_eta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."workflows" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT,
    "workspaceId" TEXT NOT NULL,
    "context" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "workflowName" TEXT,
    "metadata" TEXT,
    "configuration" TEXT,
    "workflowType" TEXT,
    "eventType" TEXT NOT NULL DEFAULT 'NO_OP',
    "automationSeriesId" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "folderId" TEXT,
    "summary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow"."workflow_executions" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "workflowType" TEXT,
    "context" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "output" TEXT,
    "parentWorkflowExecutionId" TEXT,
    "sourceStepsId" TEXT,
    "stepInputOverrideData" TEXT,
    "tag" TEXT NOT NULL DEFAULT 'root',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ignoreDuration" INTEGER NOT NULL DEFAULT 0,
    "mode" TEXT NOT NULL DEFAULT 'AUTOMATIC',
    "createdBy" TEXT,

    CONSTRAINT "workflow_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow"."workflow_execution_states" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "workflowExecutionId" TEXT NOT NULL,
    "context" TEXT,
    "output" TEXT,
    "currentStepIndex" INTEGER NOT NULL DEFAULT 0,
    "pausePath" TEXT,
    "pauseType" TEXT,
    "fireAt" TIMESTAMP(3),
    "origin" TEXT,
    "endReason" TEXT,

    CONSTRAINT "workflow_execution_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow"."workflow_mappings" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "entitySecret" TEXT NOT NULL,

    CONSTRAINT "workflow_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow"."workflow_execution_locks" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "workflowExecutionId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "expiry" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_execution_locks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow"."workflow_execution_users" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workflowExecutionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_execution_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow"."workflow_steps" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "workflowExecutionId" TEXT NOT NULL,
    "stepExecutorType" TEXT NOT NULL,
    "stepSubType" TEXT,
    "stepName" TEXT,
    "type" TEXT,
    "previousStepId" TEXT,
    "data" TEXT,
    "status" TEXT,
    "markdownSummary" TEXT,
    "attachment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow"."workflow_knowledge" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "workflowExecutionId" TEXT NOT NULL,
    "checkpointId" TEXT NOT NULL,
    "learningType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "codeContext" TEXT,
    "filePaths" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_knowledge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow"."workflow_folders" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "metadata" TEXT,
    "parentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_folders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow"."workflow_credentials" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "credType" TEXT NOT NULL,
    "authType" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."knowledge_documents" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "repositoryUrl" TEXT,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sourceKnowledgeId" TEXT,
    "workflowExecutionId" TEXT,
    "conversationId" TEXT,
    "approvedBy" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,

    CONSTRAINT "knowledge_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow"."agent_steps" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "stepsId" TEXT,
    "toolCallId" TEXT,
    "stepType" TEXT NOT NULL,
    "agentId" TEXT,
    "toolName" TEXT,
    "commitHash" TEXT,
    "repositoryURL" TEXT,
    "branch" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow"."external_step_responses" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "workflowExecutionId" TEXT NOT NULL,
    "workflowStepId" TEXT NOT NULL,
    "rawResponse" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_step_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow"."api_keys" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "keyHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scopes" TEXT,
    "expiresAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."user_groups" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "alias" TEXT,
    "description" TEXT,
    "metadata" JSONB,
    "autoRotationEnabled" BOOLEAN NOT NULL DEFAULT false,
    "rotationInterval" TEXT,
    "rotationStartDate" TIMESTAMP(3),
    "reassignOnUnavailable" BOOLEAN,
    "maxWorkload" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "user_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."roles" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."user_role_mappings" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_role_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow"."user_sessions" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "refreshTokenExpiry" TIMESTAMP(3) NOT NULL,
    "accessToken" TEXT,
    "accessTokenExpiry" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "deviceInfo" TEXT,
    "deviceId" TEXT,
    "fcmToken" TEXT,
    "voipToken" TEXT,
    "ipAddress" TEXT,
    "lastActivity" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "picture" TEXT,
    "authProvider" TEXT NOT NULL DEFAULT 'GOOGLE',
    "providerUserId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "userType" TEXT NOT NULL DEFAULT 'USER',
    "metadata" JSONB,
    "displayName" TEXT,
    "workspaceId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "orgMemberId" TEXT NOT NULL,
    "leftAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "statusEmoji" TEXT,
    "statusContent" TEXT,
    "statusExpiryAt" TIMESTAMP(3),
    "lastActiveAt" TIMESTAMP(3),
    "notificationsPausedUntil" TIMESTAMP(3),
    "assignmentUnavailableUntil" TIMESTAMP(3),
    "calendarVisibility" TEXT NOT NULL DEFAULT 'PUBLIC',
    "activityStatus" TEXT,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."user_preferences" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "askai_custom_instruction" TEXT,
    "channelSortOrder" TEXT NOT NULL DEFAULT 'RECENCY',
    "channelFilterMode" TEXT,
    "starredFilterMode" TEXT,
    "starredSortOrder" TEXT,
    "dmFilterMode" TEXT,
    "dmSortOrder" TEXT,
    "enterSendsMessage" BOOLEAN NOT NULL DEFAULT true,
    "allowThreadBroadcastMentions" BOOLEAN NOT NULL DEFAULT false,
    "showThreadTags" BOOLEAN NOT NULL DEFAULT false,
    "globalDesktopNotificationLevel" TEXT,
    "globalMobileNotificationLevel" TEXT,
    "threadReplyNotificationsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "channelWideMentionsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "notificationKeywords" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "non_zero"."user_skills" (
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "instructions" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "user_skills_pkey" PRIMARY KEY ("userId","name")
);

-- CreateTable
CREATE TABLE "non_zero"."questionnaire_responses" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT,
    "questionnaireType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "questionnaire_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "non_zero"."scheduled_messages" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "messageContent" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "daysOfWeek" TEXT NOT NULL,
    "monthlyMode" TEXT,
    "monthlyValue" INTEGER,
    "scheduledTime" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "non_zero"."call_messages" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "call_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."user_group_mappings" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userGroupId" TEXT NOT NULL,
    "roleId" TEXT,
    "responsibility" TEXT,
    "onCallSetNumber" INTEGER,
    "onCallSetNumbers" INTEGER[],
    "startOffset" INTEGER,
    "isNotified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_group_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."user_assignment_states" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userGroupId" TEXT NOT NULL,
    "onCall" BOOLEAN NOT NULL DEFAULT true,
    "isActiveForAssignment" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "user_assignment_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."board_complexity_scores" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "userGroupId" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "usePercentage" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "board_complexity_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."user_workload_mappings" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userGroupId" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "activeTasks" INTEGER NOT NULL DEFAULT 0,
    "totalTasks" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "user_workload_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."user_expertise_mappings" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userGroupId" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "hasExpertise" BOOLEAN NOT NULL DEFAULT false,
    "percentage" DOUBLE PRECISION NOT NULL DEFAULT 100.0,
    "maxTickets" INTEGER NOT NULL DEFAULT -1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "user_expertise_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."user_presence" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OFFLINE',
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isManual" BOOLEAN NOT NULL DEFAULT false,
    "deviceInfo" TEXT,
    "statusEmoji" TEXT,
    "statusContent" TEXT,
    "statusExpiryAt" TIMESTAMP(3),
    "assignmentUnavailableUntil" TIMESTAMP(3),
    "notificationsPausedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_presence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."user_profiles" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dob" TIMESTAMP(3),
    "phoneNumber" TEXT,
    "displayName" TEXT,
    "team" TEXT,
    "pronunciation" TEXT,
    "manager" TEXT,
    "role" TEXT,
    "joinedOn" TIMESTAMP(3),
    "voiceSignature" BYTEA,
    "hasVoiceSignature" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."resources" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."resource_access" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "groupId" TEXT,
    "userId" TEXT,
    "resourceId" TEXT NOT NULL,
    "accessType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "resource_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow"."acl_audit_logs" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorUserId" TEXT,
    "eventType" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acl_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "non_zero"."audit_logs" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "workspaceId" TEXT NOT NULL,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "non_zero"."audit_log_changes" (
    "id" TEXT NOT NULL,
    "auditLogId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "tableName" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "targetName" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "workspaceId" TEXT NOT NULL,

    CONSTRAINT "audit_log_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."pull_requests" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "prId" INTEGER NOT NULL,
    "workflowExecutionId" TEXT,
    "repoName" TEXT NOT NULL,
    "sourceBranchName" TEXT NOT NULL,
    "destinationBranchName" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "numberOfComments" INTEGER NOT NULL DEFAULT 0,
    "repositoryUrl" TEXT NOT NULL,
    "prUrl" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "ticketId" TEXT,

    CONSTRAINT "pull_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "non_zero"."pr_thread_links" (
    "id" TEXT NOT NULL,
    "prUrl" TEXT NOT NULL,
    "prId" INTEGER NOT NULL,
    "projectKey" TEXT NOT NULL,
    "repositorySlug" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pr_thread_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "non_zero"."team_intelligence_ingestion_batches_v2" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "reportDate" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestChecksum" TEXT NOT NULL,
    "requestPayload" JSONB,
    "contentUrl" TEXT,
    "contentSize" INTEGER,
    "contentChecksum" TEXT,
    "totalUsers" INTEGER NOT NULL,
    "queuedUsers" INTEGER NOT NULL DEFAULT 0,
    "failedUsers" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "queuedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "team_intelligence_ingestion_batches_v2_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "non_zero"."team_intelligence_user_ingestions_v2" (
    "orgId" TEXT,
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "reportDate" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "userEmail" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "teamId" TEXT,
    "teamName" TEXT,
    "aiUsage" JSONB,
    "contentUrl" TEXT,
    "contentSize" INTEGER,
    "contentChecksum" TEXT,
    "processingStatus" TEXT NOT NULL DEFAULT 'RECEIVED',
    "queueJobId" TEXT,
    "queuedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "team_intelligence_user_ingestions_v2_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "non_zero"."team_intelligence_team_summaries_v2" (
    "orgId" TEXT,
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "reportDate" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "teamId" TEXT,
    "teamName" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "totalUsers" INTEGER NOT NULL,
    "completedUsers" INTEGER NOT NULL DEFAULT 0,
    "failedUsers" INTEGER NOT NULL DEFAULT 0,
    "contentUrl" TEXT,
    "contentSize" INTEGER,
    "contentChecksum" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "queueJobId" TEXT,
    "queuedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "team_intelligence_team_summaries_v2_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "non_zero"."team_intelligence_org_summaries_v2" (
    "orgId" TEXT,
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "reportDate" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "totalTeams" INTEGER NOT NULL,
    "completedTeams" INTEGER NOT NULL DEFAULT 0,
    "failedTeams" INTEGER NOT NULL DEFAULT 0,
    "contentUrl" TEXT,
    "contentSize" INTEGER,
    "contentChecksum" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "queueJobId" TEXT,
    "queuedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "team_intelligence_org_summaries_v2_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."organizations" (
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "metadata" JSONB,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("orgId")
);

-- CreateTable
CREATE TABLE "non_zero"."organization_domains" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "verificationStatus" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "verifiedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_domains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."org_members" (
    "memberId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL DEFAULT 'deprecated',
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "passwordHash" TEXT,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invitedBy" TEXT,
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "org_members_pkey" PRIMARY KEY ("memberId")
);

-- CreateTable
CREATE TABLE "public"."workspace_organizations" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "leftAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."workspaces" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdBy" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "metadata" JSONB,
    "workspaceType" TEXT,
    "joinPolicy" TEXT,
    "landingChannelId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "non_zero"."workspace_join_requests" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_join_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "non_zero"."ai_provisioning_status" (
    "id" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL,
    "lastError" TEXT,
    "lastAttemptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_provisioning_status_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "non_zero"."org_llm_service_account_credentials" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "credentials" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "lastProvisionedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_llm_service_account_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."invitations" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "workspaceId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "invitedBy" TEXT NOT NULL,
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiredAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "invitationId" TEXT,
    "entityId" TEXT,
    "entityType" TEXT,
    "channelId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."guest_access" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "accessibleEntityId" TEXT NOT NULL,
    "accessibleEntityType" TEXT NOT NULL,
    "invitedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guest_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."projects" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "ticketSequence" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT,
    "workspaceId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'DEFAULT',
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."boards" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "boardType" TEXT NOT NULL DEFAULT 'DEFAULT',
    "projectId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT,
    "description" TEXT,
    "metadata" JSONB,
    "flowPlan" TEXT,
    "vcsProvider" TEXT,
    "releaseTrackingMode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "boards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."stages" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "eta" INTEGER,
    "boardId" TEXT NOT NULL,
    "sequenceNumber" INTEGER NOT NULL,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "defaultTicketStatus" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "defaultTicketStatusV2" TEXT NOT NULL DEFAULT 'STARTED',
    "requestApprovalOnEntry" BOOLEAN,

    CONSTRAINT "stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."stage_pr_status_mappings" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "prStatus" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stage_pr_status_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."stage_transitions" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "fromStageId" TEXT,
    "toStageId" TEXT NOT NULL,
    "formId" TEXT,
    "requiresApproval" BOOLEAN,
    "bypassApprovalForAutomation" BOOLEAN,
    "requestApprovalOnEntry" BOOLEAN,
    "visitSlaMode" TEXT,
    "fixedEtaHours" INTEGER,
    "onReenter" TEXT,
    "createdAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stage_transitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."channels" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL DEFAULT 'DEFAULT',
    "scopeType" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'PUBLIC',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,
    "metadata" JSONB,
    "projectId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "participantCount" INTEGER NOT NULL DEFAULT 0,
    "isMigrated" BOOLEAN DEFAULT false,
    "addUserPolicy" TEXT DEFAULT 'EVERYONE',
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "showTicketsTabTicketsInChat" BOOLEAN DEFAULT true,
    "callSummaryPrompt" TEXT,

    CONSTRAINT "channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."channel_board_mappings" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_board_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."channel_stats" (
    "workspaceId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "lastActivityAt" TIMESTAMP(3) NOT NULL,
    "participantCount" INTEGER NOT NULL DEFAULT 0,
    "addUserPolicy" TEXT DEFAULT 'EVERYONE',
    "lastRecapHadMessages" BOOLEAN,

    CONSTRAINT "channel_stats_pkey" PRIMARY KEY ("channelId")
);

-- CreateTable
CREATE TABLE "public"."channel_participants" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "lastViewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastViewedConversationId" TEXT,
    "isStarred" BOOLEAN NOT NULL DEFAULT false,
    "isClosed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "channel_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."channel_user_status" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastViewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastViewedConversationId" TEXT,
    "isStarred" BOOLEAN NOT NULL DEFAULT false,
    "isClosed" BOOLEAN NOT NULL DEFAULT false,
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "sectionId" TEXT,
    "sectionPosition" TEXT,
    "selectedBoardId" TEXT,
    "conversationSeenCutoffAt" TIMESTAMP(3),
    "isRecapSubscribed" BOOLEAN NOT NULL DEFAULT false,
    "lastSeenRecapDate" DATE,
    "customRecapPrompt" TEXT,
    "desktopNotificationLevel" TEXT,
    "mobileNotificationLevel" TEXT,
    "threadReplyNotificationsEnabled" BOOLEAN,
    "channelWideMentionsEnabled" BOOLEAN,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "channel_user_status_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."channel_sections" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "emoji" TEXT,
    "position" TEXT NOT NULL,
    "isCollapsed" BOOLEAN NOT NULL DEFAULT false,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" TEXT,
    "filterMode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "channel_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."agent_conversation_shares" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sourceConversationId" TEXT NOT NULL,
    "sourceTipMessageId" TEXT NOT NULL,
    "agentSlug" TEXT NOT NULL,
    "targetChannelId" TEXT NOT NULL,
    "targetConversationId" TEXT NOT NULL,
    "targetMessageId" TEXT NOT NULL,
    "sharedBy" TEXT NOT NULL,
    "shareOperationId" TEXT NOT NULL,
    "sharedMessageCount" INTEGER NOT NULL,
    "agentAdded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_conversation_shares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."conversations" (
    "conversationId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "initialMessageId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "parentMessageId" TEXT,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "replyCount" INTEGER NOT NULL DEFAULT 0,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "ticketId" TEXT,
    "metadata" JSONB,
    "callId" TEXT,
    "replies_md" TEXT,
    "ticket_md" TEXT,
    "initial_message_md" TEXT,
    "parent_message_md" TEXT,
    "sub_tickets_md" TEXT,
    "doNotPostToChannel" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "threadType" TEXT,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("conversationId")
);

-- CreateTable
CREATE TABLE "public"."conversation_participants" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "participationType" TEXT,
    "isSubscribed" BOOLEAN NOT NULL DEFAULT true,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastReadAt" TIMESTAMP(3),
    "lastReplyAt" TIMESTAMP(3),
    "channelId" TEXT,

    CONSTRAINT "conversation_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."emails" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "to" TEXT[],
    "from" TEXT NOT NULL,
    "cc" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "bcc" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "replyTo" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "conversationId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "externalThreadId" TEXT NOT NULL,
    "externalMessageId" TEXT NOT NULL,
    "sentByUserId" TEXT,
    "rfcMessageId" TEXT,
    "rating" INTEGER,
    "clientVersionName" TEXT,
    "clientVersionCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "emails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."email_drafts" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "conversationId" TEXT,
    "userId" TEXT,
    "channelId" TEXT NOT NULL,
    "draftContent" TEXT NOT NULL,
    "subject" TEXT,
    "fromAddress" TEXT,
    "attachmentIds" JSONB,
    "toRecipients" TEXT,
    "ccRecipients" TEXT,
    "bccRecipients" TEXT,
    "autoDraftStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."email_reads" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastReadEmailId" TEXT NOT NULL,
    "lastReadEmailAt" TIMESTAMP(3) NOT NULL,
    "hasNewEmail" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_reads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."conversation_labels" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "channelId" TEXT NOT NULL,
    "projectId" TEXT,
    "workspaceId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversation_labels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."conversation_label_mappings" (
    "id" TEXT NOT NULL,
    "labelId" TEXT NOT NULL,
    "labelName" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_label_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "non_zero"."desk_auto_label_rule_references" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "labelId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "filterFingerprint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "desk_auto_label_rule_references_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ticket_user_mailbox" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "state" TEXT,
    "starred" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ticket_user_mailbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."email_signatures" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_signatures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."email_channel_preferences" (
    "channelId" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "assigneeUserGroupId" TEXT,
    "boardId" TEXT,
    "sendAsEmail" TEXT,
    "defaultCc" TEXT,
    "classificationEnabled" BOOLEAN NOT NULL DEFAULT false,
    "classificationPrompt" TEXT,
    "categoryField" TEXT,
    "subCategoryField" TEXT,
    "emailMergeMode" TEXT NOT NULL DEFAULT 'ENABLED',
    "twoStepSendEnabled" BOOLEAN NOT NULL DEFAULT false,
    "priorityClassificationEnabled" BOOLEAN NOT NULL DEFAULT false,
    "priorityClassificationPrompt" TEXT,
    "priorityClassificationThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "autoDraftMode" TEXT NOT NULL DEFAULT 'OFF',
    "autoDraftAgentSlug" TEXT,
    "deskType" TEXT NOT NULL DEFAULT 'EMAIL',
    "dlEmail" TEXT,
    "dlAliases" TEXT,
    "workspaceId" TEXT NOT NULL,
    "metricsEnabled" BOOLEAN,
    "frtStageNames" TEXT,
    "metricsGuestVisibility" TEXT,
    "appWebhookDeliveryEnabled" BOOLEAN NOT NULL DEFAULT true,
    "deskReportEnabled" BOOLEAN DEFAULT false,
    "deskReportAgentSlug" TEXT,
    "deskReportRangeDays" INTEGER DEFAULT 1,
    "duplicateScopeConfig" TEXT,

    CONSTRAINT "email_channel_preferences_pkey" PRIMARY KEY ("channelId")
);

-- CreateTable
CREATE TABLE "public"."classification_mappings" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "subCategory" TEXT,
    "userGroupId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "classification_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."board_sla_policies" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "responseHours" DOUBLE PRECISION NOT NULL,
    "resolutionHours" DOUBLE PRECISION NOT NULL,
    "businessHoursOnly" BOOLEAN NOT NULL DEFAULT true,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "workdayStart" INTEGER NOT NULL DEFAULT 9,
    "workdayEnd" INTEGER NOT NULL DEFAULT 18,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "board_sla_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."messages" (
    "messageId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "childConversationId" TEXT,
    "senderId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "msgType" TEXT NOT NULL DEFAULT 'USER',
    "hasAttachment" BOOLEAN NOT NULL DEFAULT false,
    "edited" BOOLEAN NOT NULL DEFAULT false,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "showInChannel" BOOLEAN NOT NULL DEFAULT false,
    "visibleTo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,
    "nudgeCount" INTEGER DEFAULT 0,
    "isSent" BOOLEAN NOT NULL DEFAULT true,
    "reactions_md" TEXT,
    "link_preview_md" TEXT,
    "messageActs" TEXT,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("messageId")
);

-- CreateTable
CREATE TABLE "public"."message_artifacts" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "isInitialMessage" BOOLEAN NOT NULL,
    "messagePreview" TEXT NOT NULL,
    "messageCreatedAt" TIMESTAMP(3) NOT NULL,
    "command" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "callExternalId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."message_attachments" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "storageProvider" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "mimetype" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "uploadedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "url" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "metadata" JSONB,
    "conversationId" TEXT,
    "thumbnailUrl" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "uploadStatus" TEXT,
    "position" INTEGER,

    CONSTRAINT "message_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."reactions" (
    "workspaceId" TEXT NOT NULL,
    "reactionId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emojiName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reactions_pkey" PRIMARY KEY ("reactionId")
);

-- CreateTable
CREATE TABLE "public"."reaction_counts" (
    "workspaceId" TEXT NOT NULL,
    "countId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "emojiName" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reaction_counts_pkey" PRIMARY KEY ("countId")
);

-- CreateTable
CREATE TABLE "public"."custom_emojis" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "custom_emojis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."activities" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "actorAction" TEXT NOT NULL,
    "actionSource" TEXT NOT NULL,
    "actionSourceId" TEXT NOT NULL,
    "messageId" TEXT,
    "reactionId" TEXT,
    "callId" TEXT,
    "ticketId" TEXT,
    "conversationId" TEXT,
    "channelId" TEXT,
    "pullRequestId" TEXT,
    "canvasId" TEXT,
    "trackId" TEXT,
    "blockId" TEXT,
    "actorId" TEXT NOT NULL,
    "classification" TEXT NOT NULL DEFAULT 'PENDING',
    "classificationConfidence" DOUBLE PRECISION,
    "classificationJobType" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "isThreadActivity" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "conversationSeenCutoffAt" TIMESTAMP(3),

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "non_zero"."user_external_tokens" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerUserId" TEXT,
    "encryptedToken" TEXT NOT NULL,
    "refreshToken" TEXT,
    "expiresAt" TIMESTAMP(3),
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_external_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow"."external_sources" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "channelId" TEXT,
    "externalIdentifier" TEXT,
    "workspaceId" TEXT NOT NULL,
    "boardId" TEXT,
    "ownerUserId" TEXT,
    "credentials" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncCursor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow"."external_messages" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "externalSourceId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "externalThreadId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL DEFAULT 'MESSAGE',
    "entityId" TEXT,
    "messageId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."proactive_nudges" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "evidenceSpans" TEXT NOT NULL,
    "actions" JSONB,
    "state" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proactive_nudges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."surface_nudges" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "nudgeKind" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priority" TEXT DEFAULT 'medium',
    "actions" JSONB,
    "state" TEXT NOT NULL DEFAULT 'ACTIVE',
    "visibleTo" TEXT,
    "surfaceNudgeCountId" TEXT,
    "projectId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "surface_nudges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."surface_nudge_counts" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "nudgeCount" INTEGER NOT NULL,
    "userId" TEXT,
    "channelId" TEXT,
    "gid" TEXT,
    "gidType" TEXT,
    "messageId" TEXT,
    "ticketId" TEXT,
    "canvasId" TEXT,
    "callId" TEXT,
    "conversationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "surface_nudge_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow"."notifications" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UNREAD',
    "deliveryMethods" TEXT[],
    "metadata" JSONB,
    "relatedEntityType" TEXT,
    "relatedEntityId" TEXT,
    "actionUrl" TEXT,
    "expiresAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."notification_preferences" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "notificationType" TEXT NOT NULL,
    "browserEnabled" BOOLEAN NOT NULL DEFAULT true,
    "emailEnabled" BOOLEAN NOT NULL DEFAULT false,
    "slackEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow"."browser_notification_subscriptions" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "browser_notification_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."calls" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "title" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "organizerId" TEXT,
    "channelId" TEXT,
    "orgName" TEXT,
    "description" TEXT,
    "callType" TEXT NOT NULL DEFAULT 'VIDEO',
    "callOrigin" TEXT NOT NULL DEFAULT 'CHANNEL',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "roomLink" TEXT,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "isRecurring" BOOLEAN NOT NULL DEFAULT false,
    "recurringSeriesId" TEXT,
    "recurrenceRule" TEXT,
    "instanceDate" TIMESTAMP(3),
    "recordingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "recordingUrl" TEXT,
    "transcript" TEXT,
    "aiSummary" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,
    "callUpdatesChannel" TEXT,
    "participantCount" INTEGER,
    "participantPreviewUserIds" TEXT,
    "recordingParticipants" TEXT NOT NULL DEFAULT '[]',
    "summaryTemplateId" TEXT,
    "labels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "markedItems" JSONB[] DEFAULT ARRAY[]::JSONB[],
    "xyneManaged" BOOLEAN NOT NULL DEFAULT false,
    "visibility" TEXT DEFAULT 'PRIVATE',

    CONSTRAINT "calls_pkey" PRIMARY KEY ("id")
);

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
    "metadata" JSONB,
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
    "visibility" TEXT NOT NULL DEFAULT 'PRIVATE',

    CONSTRAINT "summary_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."call_participants" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "invitedBy" TEXT NOT NULL,
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "response" TEXT,
    "meetingStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "respondedAt" TIMESTAMP(3),
    "joinedAt" TIMESTAMP(3),
    "leftAt" TIMESTAMP(3),
    "metadata" JSONB,
    "displayName" TEXT,
    "email" TEXT,
    "isExternal" BOOLEAN NOT NULL DEFAULT false,
    "ringStatus" TEXT,

    CONSTRAINT "call_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "non_zero"."call_recordings" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "egressId" TEXT,
    "startedBy" TEXT NOT NULL,
    "name" TEXT,
    "recordingType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "storagePath" TEXT,
    "segmentPrefix" TEXT,
    "messageId" TEXT,
    "attachmentId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "call_recordings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."recurring_call_series" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "organizerId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "recurrenceRule" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "startsOn" TIMESTAMP(3) NOT NULL,
    "endsOn" TIMESTAMP(3),
    "metadata" JSONB,
    "callUpdatesChannel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recurring_call_series_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."recurring_call_participants" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "recurringSeriesId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "invitedBy" TEXT NOT NULL,
    "invitedAt" TIMESTAMP(3) NOT NULL,
    "response" TEXT,
    "meetingStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "respondedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "displayName" TEXT,
    "email" TEXT,
    "isExternal" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "recurring_call_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."canvas_folders" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "channelId" TEXT,
    "name" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "canvas_folders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."canvases" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "channelId" TEXT,
    "folderId" TEXT,
    "projectId" TEXT,
    "createdBy" TEXT NOT NULL,
    "viewAccessId" TEXT,
    "editAccessId" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'PRIVATE',
    "isTemplate" BOOLEAN NOT NULL DEFAULT false,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "lastEditedBy" TEXT,
    "lastEditedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,
    "isCollaborative" BOOLEAN NOT NULL DEFAULT false,
    "docType" TEXT NOT NULL DEFAULT 'Canvas',
    "userRepo" TEXT,
    "repoId" TEXT,
    "branchName" TEXT,
    "entryFile" TEXT,
    "quartoDocumentType" TEXT,
    "gcsPath" TEXT,

    CONSTRAINT "canvases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."canvas_versions" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "canvasId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "canvas_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."canvas_comment_threads" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "canvasId" TEXT NOT NULL,
    "blockId" TEXT NOT NULL,
    "anchorText" TEXT,
    "initialCommentId" TEXT,
    "commentCount" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "statusUpdatedBy" TEXT,
    "statusUpdatedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "canvas_comment_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."canvas_comments" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "canvasId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "mentionedUserIds" TEXT NOT NULL DEFAULT '[]',
    "isInitial" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT NOT NULL,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "canvas_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."canvas_participants" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "canvasId" TEXT NOT NULL,
    "userId" TEXT,
    "userGroupId" TEXT,
    "channelId" TEXT,
    "role" TEXT NOT NULL DEFAULT 'VIEWER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "canvas_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."canvas_user_status" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "canvasId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "isStarred" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "canvas_user_status_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."bookmarks" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,

    CONSTRAINT "bookmarks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."links" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "favicon" TEXT,
    "channelId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'DEFAULT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."link_access" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "link_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow"."vespa_insertion_logs" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "namespace" TEXT,
    "cluster" TEXT,
    "errorMessage" TEXT,
    "errorDetails" JSONB,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "userId" TEXT,

    CONSTRAINT "vespa_insertion_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."repos" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "canonicalUrl" TEXT,
    "baseBranch" JSONB NOT NULL,
    "prefix" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "projectId" TEXT,
    "channelId" TEXT,
    "sdlcSetupExecutionId" TEXT,
    "accessCapabilities" JSONB,
    "vcsCredentialId" TEXT,

    CONSTRAINT "repos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."sdlc_entity_links" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "repoId" TEXT,
    "channelId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "relationType" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sdlc_entity_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."sdlc_item_comments" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "anchorQuote" TEXT,
    "anchorSelector" TEXT,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sdlc_item_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."sdlc_artifacts" (
    "workspaceId" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "repoId" TEXT,
    "artifactType" TEXT NOT NULL DEFAULT 'DEFAULT',
    "artifactStatus" TEXT NOT NULL DEFAULT 'ACTIVE',
    "workflowExecutionId" TEXT,
    "generationCommit" TEXT,
    "sourceReferences" TEXT,
    "sourcePaths" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sdlc_artifacts_pkey" PRIMARY KEY ("artifactId")
);

-- CreateTable
CREATE TABLE "public"."sdlc_folders" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sdlc_folders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."sdlc_tracks" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "repoId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sdlc_tracks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."lookup_values" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lookup_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."forms" (
    "id" TEXT NOT NULL,
    "formName" TEXT NOT NULL,
    "formDescription" TEXT,
    "entityType" TEXT NOT NULL,
    "contextType" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "forms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."forms_context_mapping" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "contextId" TEXT NOT NULL,
    "contextType" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,

    CONSTRAINT "forms_context_mapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."global_fields" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "fieldName" TEXT NOT NULL,
    "fieldType" TEXT NOT NULL,
    "fieldEnum" TEXT,
    "fieldOptions" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "global_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."form_fields" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "globalFieldId" TEXT,
    "fieldName" TEXT,
    "fieldType" TEXT,
    "fieldEnum" JSONB,
    "fieldOptions" TEXT,
    "isOptional" BOOLEAN NOT NULL DEFAULT false,
    "sequenceNumber" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "parentOptionId" TEXT,

    CONSTRAINT "form_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."form_entity_values" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "contextId" TEXT,
    "version" INTEGER,
    "fieldValue" TEXT NOT NULL,
    "actualFieldValue" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "form_entity_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."dashboards" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dashboards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."queries" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "queryJson" JSONB NOT NULL,
    "entityType" TEXT,
    "targetEntity" TEXT,
    "visualType" TEXT,
    "position" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "queries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."dashboard_queries_mapping" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "dashboardId" TEXT NOT NULL,
    "queryId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dashboard_queries_mapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."merchants" (
    "id" TEXT NOT NULL,
    "mid" TEXT NOT NULL,

    CONSTRAINT "merchants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."draft_messages" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "conversationId" TEXT,
    "messageId" TEXT,
    "userId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "hasAttachment" BOOLEAN NOT NULL DEFAULT false,
    "origin" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "draft_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow"."user_activity_events" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "eventCategory" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "eventLabel" TEXT,
    "url" TEXT NOT NULL,
    "triggerType" TEXT NOT NULL DEFAULT 'CLICK',
    "contextMetadata" JSONB,
    "platform" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_activity_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow"."activity_aliases" (
    "id" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "eventCategory" TEXT NOT NULL,
    "aliasEventName" TEXT NOT NULL,
    "aliasEventCategory" TEXT NOT NULL,
    "isBlacklisted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "activity_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."collections" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "parentId" TEXT,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scopeType" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL,
    "description" TEXT,
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "rootCollectionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."collection_items" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "rootCollectionId" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "uploadedById" TEXT,
    "ingestionStatus" TEXT NOT NULL DEFAULT 'NONE',
    "versionNumber" INTEGER NOT NULL DEFAULT 1,
    "isLatest" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "collection_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."collection_permissions" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "userId" TEXT,
    "userGroupId" TEXT,
    "channelId" TEXT,
    "role" TEXT NOT NULL,
    "canShare" BOOLEAN NOT NULL DEFAULT false,
    "grantedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "collection_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."stage_approvers" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "roleId" TEXT,
    "approverType" TEXT,
    "stageId" TEXT,
    "transitionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "stage_approvers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."applications" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "mainReleaseBoardId" TEXT,
    "channelId" TEXT,
    "regex" TEXT NOT NULL,
    "repoUrl" TEXT NOT NULL,
    "deployedCommit" TEXT,
    "deployedVersion" TEXT,
    "lastDeployedAt" TIMESTAMP(3),
    "ownerTeam" TEXT NOT NULL,
    "envPaths" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "migrationPaths" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."application_release_tickets" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "applicationReleaseId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "testedBy" TEXT,
    "testedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "isHotfix" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "application_release_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "non_zero"."release_repositories" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "mainReleaseBoardId" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "deployedCommit" TEXT NOT NULL,
    "newCommit" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "release_repositories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."release_events" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "applicationReleaseId" TEXT,
    "eventType" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "userId" TEXT,
    "userName" TEXT,
    "channelId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "release_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."release_changes" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "applicationReleaseId" TEXT,
    "applicationId" TEXT,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "release_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."release_change_types" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "changeType" TEXT NOT NULL,
    "releaseId" TEXT,
    "applicationReleaseId" TEXT,
    "devTicketXyneId" TEXT,
    "commitId" TEXT,
    "filePath" TEXT,
    "createdAt" TIMESTAMP(3),

    CONSTRAINT "release_change_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ticket_stage_requests" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "formId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "submittedBy" TEXT NOT NULL,
    "reviewedBy" TEXT,
    "reviewerCommentMessageId" TEXT,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ticket_stage_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."rcas" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "summary" TEXT,
    "rootCause" TEXT,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "bugTypeId" TEXT NOT NULL,
    "categoryTypeId" TEXT NOT NULL,
    "issueCategoryId" TEXT,
    "issueStartAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rcas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."impacts" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "rcaId" TEXT,
    "impactTypeId" TEXT NOT NULL,
    "impact" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "impacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."coes" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "rcaId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "actionTypeId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "dueDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "coes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."release_attributions" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "releaseApplicationId" TEXT,
    "rootCauseTicketId" TEXT,
    "confidence" TEXT NOT NULL DEFAULT 'LOW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "release_attributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."recaps" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "recapDate" TIMESTAMP(3) NOT NULL,
    "summary" TEXT NOT NULL,
    "userId" TEXT,

    CONSTRAINT "recaps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."channel_daily_recaps" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "recapDate" DATE NOT NULL,
    "summary" TEXT NOT NULL,
    "userId" TEXT,

    CONSTRAINT "channel_daily_recaps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."channel_recaps" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "recapDate" DATE NOT NULL,
    "summary" TEXT NOT NULL,
    "userId" TEXT,

    CONSTRAINT "channel_recaps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow"."session_recording_files" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "url" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "lastProcessedTurn" INTEGER,

    CONSTRAINT "session_recording_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."surface_links" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "linkKind" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "projectId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "surface_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."apps" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdBy" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "webhookUrl" TEXT,
    "signingSecret" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "apps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."installed_apps" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "webhookUrl" TEXT,
    "signingSecret" TEXT,
    "version" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "installed_apps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."installed_app_commands" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "installedAppId" TEXT NOT NULL,
    "sourceCommandId" TEXT NOT NULL,
    "commandName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "commandType" TEXT NOT NULL,
    "commandAccessibility" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "installed_app_commands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow"."app_incoming_webhooks" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "installedAppId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "boardId" TEXT,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'SLACK',
    "action" TEXT NOT NULL DEFAULT 'MESSAGE',
    "secret" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedBy" TEXT,

    CONSTRAINT "app_incoming_webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."app_commands" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "commandName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "commandType" TEXT NOT NULL,
    "commandAccessibility" TEXT NOT NULL,
    "isForThread" BOOLEAN,
    "isForChat" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_commands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."saved_user_configurations" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contextType" TEXT NOT NULL,
    "contextId" TEXT NOT NULL,
    "visibility" TEXT NOT NULL,
    "isStarred" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_user_configurations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."saved_user_configuration_values" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "configId" TEXT NOT NULL,
    "entityName" TEXT NOT NULL,
    "fieldName" TEXT NOT NULL,
    "fieldValue" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_user_configuration_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."view_access" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "viewId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "sharedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "view_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."delayed_messages" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "conversationId" TEXT,
    "senderId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "hasAttachment" BOOLEAN NOT NULL DEFAULT false,
    "scheduledFor" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "failureReason" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delayed_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "non_zero"."data_sources" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sourceType" TEXT NOT NULL,
    "credentials" TEXT NOT NULL,
    "healthStatus" TEXT NOT NULL DEFAULT 'unknown',
    "ingestionStatus" TEXT NOT NULL DEFAULT 'pending',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "non_zero"."data_source_tables" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "dataSourceId" TEXT NOT NULL,
    "schemaName" TEXT NOT NULL,
    "tableName" TEXT NOT NULL,
    "rowCountEstimate" BIGINT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_source_tables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "non_zero"."data_source_columns" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "columnName" TEXT NOT NULL,
    "pkPosition" INTEGER,
    "dataTypeNative" TEXT NOT NULL,
    "dataTypeCanonical" TEXT NOT NULL,
    "cardinality" TEXT,
    "isNullable" BOOLEAN NOT NULL,
    "isPrimaryKey" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "displayUnit" TEXT,
    "summary" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_source_columns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "non_zero"."data_source_relationships" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "dataSourceId" TEXT NOT NULL,
    "fromColumnId" TEXT NOT NULL,
    "toColumnId" TEXT NOT NULL,
    "cardinality" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_source_relationships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "non_zero"."dynamic_dashboards" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdBy" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'PRIVATE',
    "config" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dynamic_dashboards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "non_zero"."dashboard_participants" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "dashboardId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'VIEWER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dashboard_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "non_zero"."dashboard_activity" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "actorUserId" TEXT,
    "details" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dashboard_activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "non_zero"."dynamic_dashboard_queries" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "title" TEXT,
    "queryType" TEXT NOT NULL DEFAULT 'internal',
    "queryJson" JSONB NOT NULL,
    "entityType" TEXT,
    "targetEntity" TEXT,
    "visualType" TEXT,
    "position" TEXT NOT NULL DEFAULT '{}',
    "config" TEXT NOT NULL DEFAULT '{}',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dynamic_dashboard_queries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "non_zero"."dynamic_dashboard_queries_mapping" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "dashboardId" TEXT NOT NULL,
    "queryId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dynamic_dashboard_queries_mapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."available_app_permissions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "available_app_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."app_permission" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."installed_app_permissions" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "installedAppId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UNAPPROVED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "installed_app_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "non_zero"."tags" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "configKey" TEXT,
    "tagCategory" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "reason" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "isDeleted" BOOLEAN NOT NULL,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "non_zero"."tags_config" (
    "id" TEXT NOT NULL,
    "configKey" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "isDeleted" BOOLEAN NOT NULL,

    CONSTRAINT "tags_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "non_zero"."thread_type_vocabulary" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'APPROVED',
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "thread_type_vocabulary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "non_zero"."docling_async_files" (
    "workspaceId" TEXT,
    "file_id" TEXT NOT NULL,
    "collection_id" TEXT NOT NULL,
    "source_path" TEXT NOT NULL,
    "source_storage_key" TEXT,
    "stage_dir" TEXT,
    "results_dir" TEXT,
    "base_priority" INTEGER NOT NULL DEFAULT 0,
    "priority_override" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'pending_split',
    "total_pages" INTEGER NOT NULL DEFAULT 0,
    "total_parts" INTEGER NOT NULL DEFAULT 0,
    "page_chunk_size" INTEGER NOT NULL DEFAULT 0,
    "ready_parts_count" INTEGER NOT NULL DEFAULT 0,
    "write_attempt_count" INTEGER NOT NULL DEFAULT 0,
    "split_attempt_count" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_owner" TEXT,
    "lease_token" TEXT,
    "lease_until" TIMESTAMP(3),
    "ocr_activated_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "docling_async_files_pkey" PRIMARY KEY ("file_id")
);

-- CreateTable
CREATE TABLE "non_zero"."docling_async_parts" (
    "workspaceId" TEXT,
    "file_id" TEXT NOT NULL,
    "part_index" INTEGER NOT NULL,
    "doc_id" TEXT NOT NULL,
    "current_job_id" TEXT,
    "part_path" TEXT NOT NULL,
    "result_path" TEXT,
    "start_page" INTEGER NOT NULL,
    "end_page" INTEGER NOT NULL,
    "part_size_bytes" INTEGER NOT NULL DEFAULT 0,
    "page_count" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submitted_at" TIMESTAMP(3),
    "ready_at" TIMESTAMP(3),
    "written_at" TIMESTAMP(3),
    "lease_owner" TEXT,
    "lease_until" TIMESTAMP(3),
    "submit_permit_id" TEXT,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "docling_async_parts_pk" PRIMARY KEY ("file_id","part_index")
);

-- CreateTable
CREATE TABLE "non_zero"."entities" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "canonicalName" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "mentionCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "non_zero"."entity_aliases" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "surfaceForm" TEXT NOT NULL,
    "normalizedForm" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entity_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "non_zero"."execution_items" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "sourceMessageId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "contextSummary" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "requestedBy" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "pendingOn" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "mentionedGroupIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "execution_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "non_zero"."execution_thread_states" (
    "workspaceId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "watermarkCreatedAt" TIMESTAMP(3) NOT NULL,
    "watermarkMsgId" TEXT NOT NULL,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "execution_thread_states_pkey" PRIMARY KEY ("conversationId")
);

-- CreateTable
CREATE TABLE "non_zero"."execution_item_mutations" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "op" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "sourceMessageId" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "execution_item_mutations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "non_zero"."execution_run_logs" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "gatePassed" BOOLEAN NOT NULL,
    "gateReason" TEXT NOT NULL,
    "windowSize" INTEGER NOT NULL,
    "parserRan" BOOLEAN NOT NULL DEFAULT false,
    "proposedOps" JSONB,
    "validOps" JSONB,
    "droppedOps" JSONB,
    "applied" JSONB,
    "assessment" TEXT,
    "dedupChecks" JSONB,
    "error" TEXT,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "execution_run_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "non_zero"."radar_rules" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conditions" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "radar_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agents_userDefinedId_key" ON "public"."agents"("userDefinedId");

-- CreateIndex
CREATE INDEX "agents_modelId_idx" ON "public"."agents"("modelId");

-- CreateIndex
CREATE UNIQUE INDEX "agents_name_version_key" ON "public"."agents"("name", "version");

-- CreateIndex
CREATE UNIQUE INDEX "models_userDefinedId_key" ON "public"."models"("userDefinedId");

-- CreateIndex
CREATE INDEX "models_workspaceId_idx" ON "public"."models"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "tools_name_workspaceId_key" ON "public"."tools"("name", "workspaceId");

-- CreateIndex
CREATE INDEX "agent_tools_mappings_agentId_idx" ON "public"."agent_tools_mappings"("agentId");

-- CreateIndex
CREATE INDEX "agent_tools_mappings_toolId_idx" ON "public"."agent_tools_mappings"("toolId");

-- CreateIndex
CREATE UNIQUE INDEX "agent_tools_mappings_agentId_toolId_key" ON "public"."agent_tools_mappings"("agentId", "toolId");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_messageId_key" ON "public"."tickets"("messageId");

-- CreateIndex
CREATE INDEX "tickets_status_idx" ON "public"."tickets"("status");

-- CreateIndex
CREATE INDEX "tickets_assignedTo_status_idx" ON "public"."tickets"("assignedTo", "status");

-- CreateIndex
CREATE INDEX "tickets_createdAt_idx" ON "public"."tickets"("createdAt");

-- CreateIndex
CREATE INDEX "tickets_updatedAt_idx" ON "public"."tickets"("updatedAt");

-- CreateIndex
CREATE INDEX "tickets_lastEmailAt_idx" ON "public"."tickets"("lastEmailAt");

-- CreateIndex
CREATE INDEX "tickets_eta_idx" ON "public"."tickets"("eta");

-- CreateIndex
CREATE INDEX "tickets_boardId_idx" ON "public"."tickets"("boardId");

-- CreateIndex
CREATE INDEX "tickets_projectId_idx" ON "public"."tickets"("projectId");

-- CreateIndex
CREATE INDEX "tickets_userGroupId_idx" ON "public"."tickets"("userGroupId");

-- CreateIndex
CREATE INDEX "tickets_merchantId_idx" ON "public"."tickets"("merchantId");

-- CreateIndex
CREATE INDEX "tickets_merchantId_createdAt_idx" ON "public"."tickets"("merchantId", "createdAt");

-- CreateIndex
CREATE INDEX "tickets_channelId_merchantId_idx" ON "public"."tickets"("channelId", "merchantId");

-- CreateIndex
CREATE INDEX "tickets_ticketType_idx" ON "public"."tickets"("ticketType");

-- CreateIndex
CREATE INDEX "tickets_createdBy_idx" ON "public"."tickets"("createdBy");

-- CreateIndex
CREATE INDEX "tickets_updatedBy_idx" ON "public"."tickets"("updatedBy");

-- CreateIndex
CREATE INDEX "tickets_closedBy_idx" ON "public"."tickets"("closedBy");

-- CreateIndex
CREATE INDEX "tickets_conversationId_idx" ON "public"."tickets"("conversationId");

-- CreateIndex
CREATE INDEX "tickets_channelId_idx" ON "public"."tickets"("channelId");

-- CreateIndex
CREATE INDEX "tickets_isArchived_idx" ON "public"."tickets"("isArchived");

-- CreateIndex
CREATE INDEX "tickets_isArchived_projectId_idx" ON "public"."tickets"("isArchived", "projectId");

-- CreateIndex
CREATE INDEX "tickets_isArchived_ticketType_idx" ON "public"."tickets"("isArchived", "ticketType");

-- CreateIndex
CREATE INDEX "tickets_isArchived_createdAt_id_idx" ON "public"."tickets"("isArchived", "createdAt" DESC, "id");

-- CreateIndex
CREATE INDEX "tickets_projectId_createdAt_id_idx" ON "public"."tickets"("projectId", "createdAt" DESC, "id");

-- CreateIndex
CREATE INDEX "tickets_projectId_isArchived_statusV2_createdAt_id_idx" ON "public"."tickets"("projectId", "isArchived", "statusV2", "createdAt" DESC, "id");

-- CreateIndex
CREATE INDEX "tickets_workspaceId_createdAt_id_idx" ON "public"."tickets"("workspaceId", "createdAt" DESC, "id");

-- CreateIndex
CREATE INDEX "tickets_workspaceId_statusV2_isArchived_rootId_createdAt_id_idx" ON "public"."tickets"("workspaceId", "statusV2", "isArchived", "rootId", "createdAt" DESC, "id");

-- CreateIndex
CREATE INDEX "tickets_workspaceId_createdBy_statusV2_isArchived_createdAt_idx" ON "public"."tickets"("workspaceId", "createdBy", "statusV2", "isArchived", "createdAt" DESC, "id");

-- CreateIndex
CREATE INDEX "tickets_xyneId_idx" ON "public"."tickets"("xyneId");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_workspaceId_xyneId_key" ON "public"."tickets"("workspaceId", "xyneId");

-- CreateIndex
CREATE INDEX "sub_tickets_title_idx" ON "public"."sub_tickets"("title");

-- CreateIndex
CREATE INDEX "sub_tickets_mappedTicketId_idx" ON "public"."sub_tickets"("mappedTicketId");

-- CreateIndex
CREATE INDEX "sub_tickets_createdBy_idx" ON "public"."sub_tickets"("createdBy");

-- CreateIndex
CREATE INDEX "sub_tickets_updatedBy_idx" ON "public"."sub_tickets"("updatedBy");

-- CreateIndex
CREATE INDEX "sub_tickets_assignedTo_idx" ON "public"."sub_tickets"("assignedTo");

-- CreateIndex
CREATE INDEX "sub_tickets_conversationId_idx" ON "public"."sub_tickets"("conversationId");

-- CreateIndex
CREATE INDEX "ticket_sub_ticket_mappings_ticketId_idx" ON "public"."ticket_sub_ticket_mappings"("ticketId");

-- CreateIndex
CREATE INDEX "ticket_sub_ticket_mappings_subTicketId_idx" ON "public"."ticket_sub_ticket_mappings"("subTicketId");

-- CreateIndex
CREATE INDEX "ticket_sub_ticket_mappings_ticketId_id_idx" ON "public"."ticket_sub_ticket_mappings"("ticketId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_sub_ticket_mappings_ticketId_subTicketId_key" ON "public"."ticket_sub_ticket_mappings"("ticketId", "subTicketId");

-- CreateIndex
CREATE INDEX "ticket_assignments_ticketId_idx" ON "public"."ticket_assignments"("ticketId");

-- CreateIndex
CREATE INDEX "ticket_assignments_userId_idx" ON "public"."ticket_assignments"("userId");

-- CreateIndex
CREATE INDEX "ticket_assignments_ticketId_id_idx" ON "public"."ticket_assignments"("ticketId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_assignments_ticketId_userId_userResponsibility_key" ON "public"."ticket_assignments"("ticketId", "userId", "userResponsibility");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_assignments_ticketId_roleId_key" ON "public"."ticket_assignments"("ticketId", "roleId");

-- CreateIndex
CREATE INDEX "ticket_activities_ticketId_idx" ON "public"."ticket_activities"("ticketId");

-- CreateIndex
CREATE INDEX "ticket_activities_updatedBy_idx" ON "public"."ticket_activities"("updatedBy");

-- CreateIndex
CREATE INDEX "ticket_activities_channelId_timestamp_idx" ON "public"."ticket_activities"("channelId", "timestamp");

-- CreateIndex
CREATE INDEX "ticket_entity_mappings_ticketId_idx" ON "public"."ticket_entity_mappings"("ticketId");

-- CreateIndex
CREATE INDEX "ticket_tags_ticketId_idx" ON "public"."ticket_tags"("ticketId");

-- CreateIndex
CREATE INDEX "project_tags_projectId_idx" ON "public"."project_tags"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "project_tags_projectId_name_key" ON "public"."project_tags"("projectId", "name");

-- CreateIndex
CREATE INDEX "ticket_tag_mappings_ticketId_idx" ON "public"."ticket_tag_mappings"("ticketId");

-- CreateIndex
CREATE INDEX "ticket_tag_mappings_tagId_idx" ON "public"."ticket_tag_mappings"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_tag_mappings_ticketId_tagId_key" ON "public"."ticket_tag_mappings"("ticketId", "tagId");

-- CreateIndex
CREATE INDEX "ticket_exports_workspaceId_requestedBy_createdAt_idx" ON "public"."ticket_exports"("workspaceId", "requestedBy", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ticket_reference_mappings_sourceTicketId_idx" ON "public"."ticket_reference_mappings"("sourceTicketId");

-- CreateIndex
CREATE INDEX "ticket_reference_mappings_targetTicketId_idx" ON "public"."ticket_reference_mappings"("targetTicketId");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_reference_mappings_sourceTicketId_targetTicketId_rel_key" ON "public"."ticket_reference_mappings"("sourceTicketId", "targetTicketId", "relationType");

-- CreateIndex
CREATE INDEX "ticket_stage_eta_ticketId_idx" ON "public"."ticket_stage_eta"("ticketId");

-- CreateIndex
CREATE INDEX "ticket_stage_eta_ticketId_stageId_idx" ON "public"."ticket_stage_eta"("ticketId", "stageId");

-- CreateIndex
CREATE INDEX "ticket_stage_eta_ticketId_stageId_version_idx" ON "public"."ticket_stage_eta"("ticketId", "stageId", "version");

-- CreateIndex
CREATE INDEX "ticket_stage_eta_stageId_idx" ON "public"."ticket_stage_eta"("stageId");

-- CreateIndex
CREATE INDEX "ticket_stage_eta_stageLeftAt_idx" ON "public"."ticket_stage_eta"("stageLeftAt");

-- CreateIndex
CREATE INDEX "ticket_stage_eta_stageEta_idx" ON "public"."ticket_stage_eta"("stageEta");

-- CreateIndex
CREATE INDEX "workflows_ticketId_idx" ON "public"."workflows"("ticketId");

-- CreateIndex
CREATE INDEX "workflows_ticketId_createdAt_id_idx" ON "public"."workflows"("ticketId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "workflows_createdAt_id_idx" ON "public"."workflows"("createdAt" DESC, "id");

-- CreateIndex
CREATE INDEX "workflows_eventType_status_idx" ON "public"."workflows"("eventType", "status");

-- CreateIndex
CREATE INDEX "workflows_workflowType_createdAt_id_idx" ON "public"."workflows"("workflowType", "createdAt" DESC, "id");

-- CreateIndex
CREATE INDEX "workflows_automationSeriesId_idx" ON "public"."workflows"("automationSeriesId");

-- CreateIndex
CREATE INDEX "workflows_workspaceId_eventType_status_idx" ON "public"."workflows"("workspaceId", "eventType", "status");

-- CreateIndex
CREATE INDEX "workflows_workspaceId_workflowType_createdAt_idx" ON "public"."workflows"("workspaceId", "workflowType", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "workflow_executions_workflowId_idx" ON "workflow"."workflow_executions"("workflowId");

-- CreateIndex
CREATE INDEX "workflow_executions_workflowId_createdAt_id_idx" ON "workflow"."workflow_executions"("workflowId", "createdAt" DESC, "id");

-- CreateIndex
CREATE INDEX "workflow_executions_parentWorkflowExecutionId_idx" ON "workflow"."workflow_executions"("parentWorkflowExecutionId");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_execution_states_workflowExecutionId_key" ON "workflow"."workflow_execution_states"("workflowExecutionId");

-- CreateIndex
CREATE INDEX "workflow_execution_states_workflowExecutionId_idx" ON "workflow"."workflow_execution_states"("workflowExecutionId");

-- CreateIndex
CREATE INDEX "workflow_execution_states_fireAt_idx" ON "workflow"."workflow_execution_states"("fireAt");

-- CreateIndex
CREATE INDEX "workflow_mappings_entityType_idx" ON "workflow"."workflow_mappings"("entityType");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_mappings_entityType_entityId_key" ON "workflow"."workflow_mappings"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_execution_locks_workflowExecutionId_key" ON "workflow"."workflow_execution_locks"("workflowExecutionId");

-- CreateIndex
CREATE INDEX "workflow_execution_users_userId_idx" ON "workflow"."workflow_execution_users"("userId");

-- CreateIndex
CREATE INDEX "workflow_execution_users_workflowExecutionId_idx" ON "workflow"."workflow_execution_users"("workflowExecutionId");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_execution_users_userId_workflowExecutionId_key" ON "workflow"."workflow_execution_users"("userId", "workflowExecutionId");

-- CreateIndex
CREATE INDEX "workflow_steps_stepSubType_idx" ON "workflow"."workflow_steps"("stepSubType");

-- CreateIndex
CREATE INDEX "workflow_steps_workflowExecutionId_idx" ON "workflow"."workflow_steps"("workflowExecutionId");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_steps_workflowExecutionId_stepName_key" ON "workflow"."workflow_steps"("workflowExecutionId", "stepName");

-- CreateIndex
CREATE INDEX "workflow_folders_workspaceId_idx" ON "workflow"."workflow_folders"("workspaceId");

-- CreateIndex
CREATE INDEX "workflow_folders_workspaceId_parentId_idx" ON "workflow"."workflow_folders"("workspaceId", "parentId");

-- CreateIndex
CREATE INDEX "workflow_credentials_workspaceId_idx" ON "workflow"."workflow_credentials"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_credentials_workspaceId_name_key" ON "workflow"."workflow_credentials"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "knowledge_documents_projectId_idx" ON "public"."knowledge_documents"("projectId");

-- CreateIndex
CREATE INDEX "knowledge_documents_projectId_repositoryUrl_idx" ON "public"."knowledge_documents"("projectId", "repositoryUrl");

-- CreateIndex
CREATE INDEX "agent_steps_agentId_idx" ON "workflow"."agent_steps"("agentId");

-- CreateIndex
CREATE UNIQUE INDEX "external_step_responses_workflowStepId_key" ON "workflow"."external_step_responses"("workflowStepId");

-- CreateIndex
CREATE INDEX "external_step_responses_workflowExecutionId_idx" ON "workflow"."external_step_responses"("workflowExecutionId");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_keyHash_key" ON "workflow"."api_keys"("keyHash");

-- CreateIndex
CREATE INDEX "api_keys_userId_idx" ON "workflow"."api_keys"("userId");

-- CreateIndex
CREATE INDEX "user_groups_workspaceId_createdAt_id_idx" ON "public"."user_groups"("workspaceId", "createdAt" DESC, "id");

-- CreateIndex
CREATE INDEX "user_groups_workspaceId_name_id_idx" ON "public"."user_groups"("workspaceId", "name", "id");

-- CreateIndex
CREATE INDEX "user_groups_createdBy_idx" ON "public"."user_groups"("createdBy");

-- CreateIndex
CREATE UNIQUE INDEX "user_groups_workspaceId_name_key" ON "public"."user_groups"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "roles_workspaceId_createdAt_id_idx" ON "public"."roles"("workspaceId", "createdAt" DESC, "id");

-- CreateIndex
CREATE INDEX "roles_workspaceId_isActive_idx" ON "public"."roles"("workspaceId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "roles_workspaceId_name_key" ON "public"."roles"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "user_role_mappings_userId_idx" ON "public"."user_role_mappings"("userId");

-- CreateIndex
CREATE INDEX "user_role_mappings_roleId_idx" ON "public"."user_role_mappings"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "user_role_mappings_userId_roleId_key" ON "public"."user_role_mappings"("userId", "roleId");

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_refreshToken_key" ON "workflow"."user_sessions"("refreshToken");

-- CreateIndex
CREATE INDEX "user_sessions_userId_idx" ON "workflow"."user_sessions"("userId");

-- CreateIndex
CREATE INDEX "user_sessions_refreshToken_idx" ON "workflow"."user_sessions"("refreshToken");

-- CreateIndex
CREATE INDEX "user_sessions_status_idx" ON "workflow"."user_sessions"("status");

-- CreateIndex
CREATE INDEX "user_sessions_refreshTokenExpiry_idx" ON "workflow"."user_sessions"("refreshTokenExpiry");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "public"."users"("email");

-- CreateIndex
CREATE INDEX "users_providerUserId_idx" ON "public"."users"("providerUserId");

-- CreateIndex
CREATE INDEX "users_workspaceId_id_idx" ON "public"."users"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "users_activityStatus_idx" ON "public"."users"("activityStatus");

-- CreateIndex
CREATE UNIQUE INDEX "users_providerUserId_workspaceId_key" ON "public"."users"("providerUserId", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_workspaceId_key" ON "public"."users"("email", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "user_preferences_userId_key" ON "public"."user_preferences"("userId");

-- CreateIndex
CREATE INDEX "questionnaire_responses_userId_idx" ON "non_zero"."questionnaire_responses"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "questionnaire_responses_workspaceId_questionnaireType_userI_key" ON "non_zero"."questionnaire_responses"("workspaceId", "questionnaireType", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "questionnaire_responses_email_questionnaireType_key" ON "non_zero"."questionnaire_responses"("email", "questionnaireType");

-- CreateIndex
CREATE INDEX "scheduled_messages_channelId_idx" ON "non_zero"."scheduled_messages"("channelId");

-- CreateIndex
CREATE INDEX "scheduled_messages_createdBy_idx" ON "non_zero"."scheduled_messages"("createdBy");

-- CreateIndex
CREATE INDEX "call_messages_callId_createdAt_idx" ON "non_zero"."call_messages"("callId", "createdAt");

-- CreateIndex
CREATE INDEX "user_group_mappings_userId_idx" ON "public"."user_group_mappings"("userId");

-- CreateIndex
CREATE INDEX "user_group_mappings_userGroupId_idx" ON "public"."user_group_mappings"("userGroupId");

-- CreateIndex
CREATE INDEX "user_group_mappings_roleId_idx" ON "public"."user_group_mappings"("roleId");

-- CreateIndex
CREATE INDEX "user_group_mappings_userGroupId_createdAt_id_idx" ON "public"."user_group_mappings"("userGroupId", "createdAt" DESC, "id" ASC);

-- CreateIndex
CREATE INDEX "user_group_mappings_userGroupId_onCallSetNumber_idx" ON "public"."user_group_mappings"("userGroupId", "onCallSetNumber");

-- CreateIndex
CREATE INDEX "user_group_mappings_userGroupId_onCallSetNumbers_idx" ON "public"."user_group_mappings"("userGroupId", "onCallSetNumbers");

-- CreateIndex
CREATE UNIQUE INDEX "user_group_mappings_userId_userGroupId_key" ON "public"."user_group_mappings"("userId", "userGroupId");

-- CreateIndex
CREATE INDEX "user_assignment_states_userGroupId_idx" ON "public"."user_assignment_states"("userGroupId");

-- CreateIndex
CREATE INDEX "user_assignment_states_userId_idx" ON "public"."user_assignment_states"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_assignment_states_userId_userGroupId_key" ON "public"."user_assignment_states"("userId", "userGroupId");

-- CreateIndex
CREATE INDEX "board_complexity_scores_userGroupId_idx" ON "public"."board_complexity_scores"("userGroupId");

-- CreateIndex
CREATE INDEX "board_complexity_scores_boardId_idx" ON "public"."board_complexity_scores"("boardId");

-- CreateIndex
CREATE UNIQUE INDEX "board_complexity_scores_userGroupId_boardId_key" ON "public"."board_complexity_scores"("userGroupId", "boardId");

-- CreateIndex
CREATE INDEX "user_workload_mappings_userGroupId_idx" ON "public"."user_workload_mappings"("userGroupId");

-- CreateIndex
CREATE INDEX "user_workload_mappings_userId_idx" ON "public"."user_workload_mappings"("userId");

-- CreateIndex
CREATE INDEX "user_workload_mappings_boardId_idx" ON "public"."user_workload_mappings"("boardId");

-- CreateIndex
CREATE UNIQUE INDEX "user_workload_mappings_userId_userGroupId_boardId_key" ON "public"."user_workload_mappings"("userId", "userGroupId", "boardId");

-- CreateIndex
CREATE INDEX "user_expertise_mappings_userGroupId_idx" ON "public"."user_expertise_mappings"("userGroupId");

-- CreateIndex
CREATE INDEX "user_expertise_mappings_userId_idx" ON "public"."user_expertise_mappings"("userId");

-- CreateIndex
CREATE INDEX "user_expertise_mappings_boardId_idx" ON "public"."user_expertise_mappings"("boardId");

-- CreateIndex
CREATE UNIQUE INDEX "user_expertise_mappings_userId_userGroupId_boardId_key" ON "public"."user_expertise_mappings"("userId", "userGroupId", "boardId");

-- CreateIndex
CREATE UNIQUE INDEX "user_presence_userId_key" ON "public"."user_presence"("userId");

-- CreateIndex
CREATE INDEX "user_presence_status_idx" ON "public"."user_presence"("status");

-- CreateIndex
CREATE INDEX "user_presence_lastActiveAt_idx" ON "public"."user_presence"("lastActiveAt");

-- CreateIndex
CREATE UNIQUE INDEX "user_profiles_userId_key" ON "public"."user_profiles"("userId");

-- CreateIndex
CREATE INDEX "user_profiles_userId_idx" ON "public"."user_profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "resources_name_key" ON "public"."resources"("name");

-- CreateIndex
CREATE INDEX "resources_name_id_idx" ON "public"."resources"("name", "id");

-- CreateIndex
CREATE INDEX "resource_access_groupId_idx" ON "public"."resource_access"("groupId");

-- CreateIndex
CREATE INDEX "resource_access_userId_idx" ON "public"."resource_access"("userId");

-- CreateIndex
CREATE INDEX "resource_access_resourceId_idx" ON "public"."resource_access"("resourceId");

-- CreateIndex
CREATE INDEX "resource_access_userId_id_idx" ON "public"."resource_access"("userId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "resource_access_groupId_resourceId_accessType_key" ON "public"."resource_access"("groupId", "resourceId", "accessType");

-- CreateIndex
CREATE UNIQUE INDEX "resource_access_userId_resourceId_accessType_key" ON "public"."resource_access"("userId", "resourceId", "accessType");

-- CreateIndex
CREATE INDEX "acl_audit_logs_timestamp_idx" ON "workflow"."acl_audit_logs"("timestamp");

-- CreateIndex
CREATE INDEX "acl_audit_logs_eventType_idx" ON "workflow"."acl_audit_logs"("eventType");

-- CreateIndex
CREATE INDEX "acl_audit_logs_targetType_targetId_idx" ON "workflow"."acl_audit_logs"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "acl_audit_logs_actorUserId_idx" ON "workflow"."acl_audit_logs"("actorUserId");

-- CreateIndex
CREATE INDEX "audit_logs_workspaceId_entityType_entityId_createdAt_idx" ON "non_zero"."audit_logs"("workspaceId", "entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_actorUserId_idx" ON "non_zero"."audit_logs"("actorUserId");

-- CreateIndex
CREATE INDEX "audit_log_changes_auditLogId_idx" ON "non_zero"."audit_log_changes"("auditLogId");

-- CreateIndex
CREATE INDEX "pull_requests_workflowExecutionId_idx" ON "public"."pull_requests"("workflowExecutionId");

-- CreateIndex
CREATE INDEX "pull_requests_date_idx" ON "public"."pull_requests"("date");

-- CreateIndex
CREATE INDEX "pull_requests_ticketId_date_idx" ON "public"."pull_requests"("ticketId", "date" DESC);

-- CreateIndex
CREATE INDEX "pr_thread_links_prId_idx" ON "non_zero"."pr_thread_links"("prId");

-- CreateIndex
CREATE INDEX "pr_thread_links_conversationId_idx" ON "non_zero"."pr_thread_links"("conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "pr_thread_links_prUrl_conversationId_key" ON "non_zero"."pr_thread_links"("prUrl", "conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "team_intelligence_ingestion_batches_v2_idempotencyKey_key" ON "non_zero"."team_intelligence_ingestion_batches_v2"("idempotencyKey");

-- CreateIndex
CREATE INDEX "team_intelligence_ingestion_batches_v2_orgId_idx" ON "non_zero"."team_intelligence_ingestion_batches_v2"("orgId");

-- CreateIndex
CREATE INDEX "team_intelligence_ingestion_batches_v2_reportDate_idx" ON "non_zero"."team_intelligence_ingestion_batches_v2"("reportDate");

-- CreateIndex
CREATE INDEX "team_intelligence_ingestion_batches_v2_source_reportDate_idx" ON "non_zero"."team_intelligence_ingestion_batches_v2"("source", "reportDate");

-- CreateIndex
CREATE INDEX "team_intelligence_ingestion_batches_v2_status_receivedAt_idx" ON "non_zero"."team_intelligence_ingestion_batches_v2"("status", "receivedAt");

-- CreateIndex
CREATE INDEX "team_intelligence_user_ingestions_v2_orgId_idx" ON "non_zero"."team_intelligence_user_ingestions_v2"("orgId");

-- CreateIndex
CREATE INDEX "team_intelligence_user_ingestions_v2_reportDate_userEmail_idx" ON "non_zero"."team_intelligence_user_ingestions_v2"("reportDate", "userEmail");

-- CreateIndex
CREATE INDEX "team_intelligence_user_ingestions_v2_batchId_processingStat_idx" ON "non_zero"."team_intelligence_user_ingestions_v2"("batchId", "processingStatus");

-- CreateIndex
CREATE INDEX "team_intelligence_user_ingestions_v2_source_reportDate_idx" ON "non_zero"."team_intelligence_user_ingestions_v2"("source", "reportDate");

-- CreateIndex
CREATE UNIQUE INDEX "team_intelligence_user_ingestions_v2_batchId_userEmail_key" ON "non_zero"."team_intelligence_user_ingestions_v2"("batchId", "userEmail");

-- CreateIndex
CREATE UNIQUE INDEX "team_intelligence_team_summaries_v2_idempotencyKey_key" ON "non_zero"."team_intelligence_team_summaries_v2"("idempotencyKey");

-- CreateIndex
CREATE INDEX "team_intelligence_team_summaries_v2_orgId_idx" ON "non_zero"."team_intelligence_team_summaries_v2"("orgId");

-- CreateIndex
CREATE INDEX "team_intelligence_team_summaries_v2_reportDate_teamId_idx" ON "non_zero"."team_intelligence_team_summaries_v2"("reportDate", "teamId");

-- CreateIndex
CREATE INDEX "team_intelligence_team_summaries_v2_batchId_status_idx" ON "non_zero"."team_intelligence_team_summaries_v2"("batchId", "status");

-- CreateIndex
CREATE INDEX "team_intelligence_team_summaries_v2_source_reportDate_idx" ON "non_zero"."team_intelligence_team_summaries_v2"("source", "reportDate");

-- CreateIndex
CREATE UNIQUE INDEX "team_intelligence_team_summaries_v2_batchId_teamId_key" ON "non_zero"."team_intelligence_team_summaries_v2"("batchId", "teamId");

-- CreateIndex
CREATE UNIQUE INDEX "team_intelligence_org_summaries_v2_batchId_key" ON "non_zero"."team_intelligence_org_summaries_v2"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "team_intelligence_org_summaries_v2_idempotencyKey_key" ON "non_zero"."team_intelligence_org_summaries_v2"("idempotencyKey");

-- CreateIndex
CREATE INDEX "team_intelligence_org_summaries_v2_orgId_idx" ON "non_zero"."team_intelligence_org_summaries_v2"("orgId");

-- CreateIndex
CREATE INDEX "team_intelligence_org_summaries_v2_reportDate_idx" ON "non_zero"."team_intelligence_org_summaries_v2"("reportDate");

-- CreateIndex
CREATE INDEX "team_intelligence_org_summaries_v2_source_reportDate_idx" ON "non_zero"."team_intelligence_org_summaries_v2"("source", "reportDate");

-- CreateIndex
CREATE INDEX "team_intelligence_org_summaries_v2_status_createdAt_idx" ON "non_zero"."team_intelligence_org_summaries_v2"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_name_key" ON "public"."organizations"("name");

-- CreateIndex
CREATE INDEX "organizations_status_name_idx" ON "public"."organizations"("status", "name");

-- CreateIndex
CREATE INDEX "organization_domains_orgId_idx" ON "non_zero"."organization_domains"("orgId");

-- CreateIndex
CREATE INDEX "organization_domains_domain_verificationStatus_idx" ON "non_zero"."organization_domains"("domain", "verificationStatus");

-- CreateIndex
CREATE UNIQUE INDEX "organization_domains_orgId_domain_key" ON "non_zero"."organization_domains"("orgId", "domain");

-- CreateIndex
CREATE UNIQUE INDEX "org_members_email_key" ON "public"."org_members"("email");

-- CreateIndex
CREATE INDEX "org_members_orgId_idx" ON "public"."org_members"("orgId");

-- CreateIndex
CREATE INDEX "org_members_orgId_joinedAt_idx" ON "public"."org_members"("orgId", "joinedAt");

-- CreateIndex
CREATE INDEX "workspace_organizations_orgId_idx" ON "public"."workspace_organizations"("orgId");

-- CreateIndex
CREATE INDEX "workspace_organizations_workspaceId_idx" ON "public"."workspace_organizations"("workspaceId");

-- CreateIndex
CREATE INDEX "workspace_organizations_workspaceId_createdAt_id_idx" ON "public"."workspace_organizations"("workspaceId", "createdAt" DESC, "id");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_organizations_orgId_workspaceId_key" ON "public"."workspace_organizations"("orgId", "workspaceId");

-- CreateIndex
CREATE INDEX "workspaces_orgId_idx" ON "public"."workspaces"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "workspaces_orgId_name_key" ON "public"."workspaces"("orgId", "name");

-- CreateIndex
CREATE INDEX "workspace_join_requests_workspaceId_email_updatedAt_idx" ON "non_zero"."workspace_join_requests"("workspaceId", "email", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "workspace_join_requests_email_status_updatedAt_idx" ON "non_zero"."workspace_join_requests"("email", "status", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "workspace_join_requests_workspaceId_status_createdAt_idx" ON "non_zero"."workspace_join_requests"("workspaceId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ai_provisioning_status_status_updatedAt_idx" ON "non_zero"."ai_provisioning_status"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ai_provisioning_status_subjectType_subjectId_provider_key" ON "non_zero"."ai_provisioning_status"("subjectType", "subjectId", "provider");

-- CreateIndex
CREATE INDEX "org_llm_service_account_credentials_orgId_status_idx" ON "non_zero"."org_llm_service_account_credentials"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "org_llm_service_account_credentials_orgId_provider_purpose_key" ON "non_zero"."org_llm_service_account_credentials"("orgId", "provider", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_invitationId_key" ON "public"."invitations"("invitationId");

-- CreateIndex
CREATE INDEX "invitations_orgId_idx" ON "public"."invitations"("orgId");

-- CreateIndex
CREATE INDEX "invitations_workspaceId_idx" ON "public"."invitations"("workspaceId");

-- CreateIndex
CREATE INDEX "invitations_email_idx" ON "public"."invitations"("email");

-- CreateIndex
CREATE INDEX "invitations_invitationId_idx" ON "public"."invitations"("invitationId");

-- CreateIndex
CREATE INDEX "invitations_entityId_idx" ON "public"."invitations"("entityId");

-- CreateIndex
CREATE INDEX "invitations_createdAt_id_idx" ON "public"."invitations"("createdAt" DESC, "id");

-- CreateIndex
CREATE INDEX "guest_access_workspaceId_userId_idx" ON "public"."guest_access"("workspaceId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "guest_access_userId_accessibleEntityId_accessibleEntityType_key" ON "public"."guest_access"("userId", "accessibleEntityId", "accessibleEntityType");

-- CreateIndex
CREATE INDEX "projects_workspaceId_createdAt_id_idx" ON "public"."projects"("workspaceId", "createdAt" DESC, "id");

-- CreateIndex
CREATE UNIQUE INDEX "projects_name_workspaceId_key" ON "public"."projects"("name", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "projects_code_workspaceId_key" ON "public"."projects"("code", "workspaceId");

-- CreateIndex
CREATE INDEX "boards_projectId_idx" ON "public"."boards"("projectId");

-- CreateIndex
CREATE INDEX "boards_workspaceId_createdAt_id_idx" ON "public"."boards"("workspaceId", "createdAt" DESC, "id");

-- CreateIndex
CREATE INDEX "boards_projectId_createdAt_id_idx" ON "public"."boards"("projectId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "boards_name_projectId_key" ON "public"."boards"("name", "projectId");

-- CreateIndex
CREATE INDEX "stages_boardId_idx" ON "public"."stages"("boardId");

-- CreateIndex
CREATE INDEX "stages_boardId_sequenceNumber_idx" ON "public"."stages"("boardId", "sequenceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "stage_pr_status_mappings_stageId_prStatus_key" ON "public"."stage_pr_status_mappings"("stageId", "prStatus");

-- CreateIndex
CREATE INDEX "stage_transitions_boardId_idx" ON "public"."stage_transitions"("boardId");

-- CreateIndex
CREATE INDEX "stage_transitions_fromStageId_idx" ON "public"."stage_transitions"("fromStageId");

-- CreateIndex
CREATE INDEX "stage_transitions_boardId_toStageId_idx" ON "public"."stage_transitions"("boardId", "toStageId");

-- CreateIndex
CREATE INDEX "stage_transitions_toStageId_idx" ON "public"."stage_transitions"("toStageId");

-- CreateIndex
CREATE UNIQUE INDEX "stage_transitions_boardId_fromStageId_toStageId_key" ON "public"."stage_transitions"("boardId", "fromStageId", "toStageId");

-- CreateIndex
CREATE INDEX "channels_projectId_idx" ON "public"."channels"("projectId");

-- CreateIndex
CREATE INDEX "channels_workspaceId_visibility_id_idx" ON "public"."channels"("workspaceId", "visibility", "id");

-- CreateIndex
CREATE INDEX "channels_createdBy_idx" ON "public"."channels"("createdBy");

-- CreateIndex
CREATE INDEX "channels_isArchived_idx" ON "public"."channels"("isArchived");

-- CreateIndex
CREATE INDEX "channels_workspaceId_id_idx" ON "public"."channels"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "channels_workspaceId_name_id_idx" ON "public"."channels"("workspaceId", "name", "id");

-- CreateIndex
CREATE INDEX "channel_board_mappings_channelId_idx" ON "public"."channel_board_mappings"("channelId");

-- CreateIndex
CREATE UNIQUE INDEX "channel_board_mappings_channelId_boardId_key" ON "public"."channel_board_mappings"("channelId", "boardId");

-- CreateIndex
CREATE INDEX "channel_stats_channelId_idx" ON "public"."channel_stats"("channelId");

-- CreateIndex
CREATE INDEX "channel_stats_workspaceId_lastActivityAt_channelId_idx" ON "public"."channel_stats"("workspaceId", "lastActivityAt" DESC, "channelId" DESC);

-- CreateIndex
CREATE INDEX "channel_participants_channelId_idx" ON "public"."channel_participants"("channelId");

-- CreateIndex
CREATE INDEX "channel_participants_userId_idx" ON "public"."channel_participants"("userId");

-- CreateIndex
CREATE INDEX "channel_participants_userId_isStarred_idx" ON "public"."channel_participants"("userId", "isStarred");

-- CreateIndex
CREATE INDEX "channel_participants_userId_isClosed_idx" ON "public"."channel_participants"("userId", "isClosed");

-- CreateIndex
CREATE INDEX "channel_participants_channelId_userId_id_idx" ON "public"."channel_participants"("channelId", "userId", "id");

-- CreateIndex
CREATE INDEX "channel_participants_userId_role_id_idx" ON "public"."channel_participants"("userId", "role", "id");

-- CreateIndex
CREATE INDEX "channel_participants_channelId_id_idx" ON "public"."channel_participants"("channelId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "channel_participants_channelId_userId_key" ON "public"."channel_participants"("channelId", "userId");

-- CreateIndex
CREATE INDEX "channel_user_status_channelId_idx" ON "public"."channel_user_status"("channelId");

-- CreateIndex
CREATE INDEX "channel_user_status_userId_idx" ON "public"."channel_user_status"("userId");

-- CreateIndex
CREATE INDEX "channel_user_status_userId_isStarred_idx" ON "public"."channel_user_status"("userId", "isStarred");

-- CreateIndex
CREATE INDEX "channel_user_status_userId_isClosed_idx" ON "public"."channel_user_status"("userId", "isClosed");

-- CreateIndex
CREATE INDEX "channel_user_status_userId_isRecapSubscribed_idx" ON "public"."channel_user_status"("userId", "isRecapSubscribed");

-- CreateIndex
CREATE INDEX "channel_user_status_userId_isDeleted_id_idx" ON "public"."channel_user_status"("userId", "isDeleted", "id");

-- CreateIndex
CREATE INDEX "channel_user_status_userId_sectionId_idx" ON "public"."channel_user_status"("userId", "sectionId");

-- CreateIndex
CREATE UNIQUE INDEX "channel_user_status_channelId_userId_key" ON "public"."channel_user_status"("channelId", "userId");

-- CreateIndex
CREATE INDEX "channel_sections_userId_workspaceId_isDeleted_idx" ON "public"."channel_sections"("userId", "workspaceId", "isDeleted");

-- CreateIndex
CREATE UNIQUE INDEX "agent_conversation_shares_targetConversationId_key" ON "public"."agent_conversation_shares"("targetConversationId");

-- CreateIndex
CREATE UNIQUE INDEX "agent_conversation_shares_targetMessageId_key" ON "public"."agent_conversation_shares"("targetMessageId");

-- CreateIndex
CREATE INDEX "agent_conversation_shares_workspaceId_sourceConversationId__idx" ON "public"."agent_conversation_shares"("workspaceId", "sourceConversationId", "targetChannelId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "agent_conversation_shares_workspaceId_targetChannelId_share_key" ON "public"."agent_conversation_shares"("workspaceId", "targetChannelId", "sharedBy", "shareOperationId");

-- CreateIndex
CREATE INDEX "conversations_channelId_lastActivityAt_idx" ON "public"."conversations"("channelId", "lastActivityAt");

-- CreateIndex
CREATE INDEX "conversations_workspaceId_idx" ON "public"."conversations"("workspaceId");

-- CreateIndex
CREATE INDEX "conversations_channelId_idx" ON "public"."conversations"("channelId");

-- CreateIndex
CREATE INDEX "conversations_ticketId_idx" ON "public"."conversations"("ticketId");

-- CreateIndex
CREATE INDEX "conversations_callId_idx" ON "public"."conversations"("callId");

-- CreateIndex
CREATE INDEX "conversations_conversationId_callId_idx" ON "public"."conversations"("conversationId", "callId");

-- CreateIndex
CREATE INDEX "conversations_channelId_createdAt_conversationId_idx" ON "public"."conversations"("channelId", "createdAt" DESC, "conversationId" ASC);

-- CreateIndex
CREATE INDEX "conversations_channelId_doNotPostToChannel_createdAt_conver_idx" ON "public"."conversations"("channelId", "doNotPostToChannel", "createdAt" DESC, "conversationId" ASC);

-- CreateIndex
CREATE INDEX "conversations_createdBy_idx" ON "public"."conversations"("createdBy");

-- CreateIndex
CREATE INDEX "conversations_initialMessageId_idx" ON "public"."conversations"("initialMessageId");

-- CreateIndex
CREATE INDEX "conversation_participants_conversationId_idx" ON "public"."conversation_participants"("conversationId");

-- CreateIndex
CREATE INDEX "conversation_participants_conversationId_participationType__idx" ON "public"."conversation_participants"("conversationId", "participationType", "joinedAt", "id");

-- CreateIndex
CREATE INDEX "conversation_participants_userId_idx" ON "public"."conversation_participants"("userId");

-- CreateIndex
CREATE INDEX "conversation_participants_userId_lastReplyAt_id_idx" ON "public"."conversation_participants"("userId", "lastReplyAt" DESC, "id");

-- CreateIndex
CREATE INDEX "conversation_participants_thread_list_idx" ON "public"."conversation_participants"("userId", "isSubscribed", "lastReplyAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "conversation_participants_userId_id_idx" ON "public"."conversation_participants"("userId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_participants_conversationId_userId_key" ON "public"."conversation_participants"("conversationId", "userId");

-- CreateIndex
CREATE INDEX "emails_conversationId_idx" ON "public"."emails"("conversationId");

-- CreateIndex
CREATE INDEX "emails_externalThreadId_idx" ON "public"."emails"("externalThreadId");

-- CreateIndex
CREATE INDEX "emails_channelId_idx" ON "public"."emails"("channelId");

-- CreateIndex
CREATE INDEX "emails_channelId_rfcMessageId_idx" ON "public"."emails"("channelId", "rfcMessageId");

-- CreateIndex
CREATE INDEX "emails_conversationId_id_idx" ON "public"."emails"("conversationId", "id");

-- CreateIndex
CREATE INDEX "emails_sentByUserId_createdAt_idx" ON "public"."emails"("sentByUserId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "emails_channelId_type_id_createdAt_idx" ON "public"."emails"("channelId", "type", "id", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "emails_externalMessageId_channelId_key" ON "public"."emails"("externalMessageId", "channelId");

-- CreateIndex
CREATE INDEX "email_drafts_userId_conversationId_id_idx" ON "public"."email_drafts"("userId", "conversationId", "id");

-- CreateIndex
CREATE INDEX "email_drafts_conversationId_idx" ON "public"."email_drafts"("conversationId");

-- CreateIndex
CREATE INDEX "email_drafts_channelId_idx" ON "public"."email_drafts"("channelId");

-- CreateIndex
CREATE UNIQUE INDEX "email_drafts_userId_conversationId_key" ON "public"."email_drafts"("userId", "conversationId");

-- CreateIndex
CREATE INDEX "email_reads_userId_idx" ON "public"."email_reads"("userId");

-- CreateIndex
CREATE INDEX "email_reads_ticketId_idx" ON "public"."email_reads"("ticketId");

-- CreateIndex
CREATE UNIQUE INDEX "email_reads_ticketId_userId_key" ON "public"."email_reads"("ticketId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_labels_channelId_createdBy_name_key" ON "public"."conversation_labels"("channelId", "createdBy", "name");

-- CreateIndex
CREATE INDEX "conversation_label_mappings_labelId_idx" ON "public"."conversation_label_mappings"("labelId");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_label_mappings_conversationId_labelId_key" ON "public"."conversation_label_mappings"("conversationId", "labelId");

-- CreateIndex
CREATE INDEX "desk_auto_label_rule_refs_owner_channel_idx" ON "non_zero"."desk_auto_label_rule_references"("workspaceId", "ownerId", "channelId", "createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "desk_auto_label_rule_refs_channel_idx" ON "non_zero"."desk_auto_label_rule_references"("workspaceId", "channelId");

-- CreateIndex
CREATE INDEX "desk_auto_label_rule_refs_label_idx" ON "non_zero"."desk_auto_label_rule_references"("workspaceId", "labelId");

-- CreateIndex
CREATE UNIQUE INDEX "desk_auto_label_rule_references_workflowId_labelId_key" ON "non_zero"."desk_auto_label_rule_references"("workflowId", "labelId");

-- CreateIndex
CREATE UNIQUE INDEX "desk_auto_label_rule_refs_filter_key" ON "non_zero"."desk_auto_label_rule_references"("workspaceId", "ownerId", "channelId", "labelId", "filterFingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_user_mailbox_ticketId_userId_key" ON "public"."ticket_user_mailbox"("ticketId", "userId");

-- CreateIndex
CREATE INDEX "email_signatures_userId_name_id_idx" ON "public"."email_signatures"("userId", "name", "id");

-- CreateIndex
CREATE INDEX "email_channel_preferences_ownerUserId_idx" ON "public"."email_channel_preferences"("ownerUserId");

-- CreateIndex
CREATE INDEX "email_channel_preferences_assigneeUserGroupId_idx" ON "public"."email_channel_preferences"("assigneeUserGroupId");

-- CreateIndex
CREATE INDEX "email_channel_preferences_boardId_idx" ON "public"."email_channel_preferences"("boardId");

-- CreateIndex
CREATE UNIQUE INDEX "email_channel_preferences_workspaceId_dlEmail_key" ON "public"."email_channel_preferences"("workspaceId", "dlEmail");

-- CreateIndex
CREATE INDEX "classification_mappings_channelId_idx" ON "public"."classification_mappings"("channelId");

-- CreateIndex
CREATE INDEX "classification_mappings_channelId_category_idx" ON "public"."classification_mappings"("channelId", "category");

-- CreateIndex
CREATE INDEX "board_sla_policies_boardId_idx" ON "public"."board_sla_policies"("boardId");

-- CreateIndex
CREATE INDEX "board_sla_policies_isActive_idx" ON "public"."board_sla_policies"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "board_sla_policies_boardId_priority_key" ON "public"."board_sla_policies"("boardId", "priority");

-- CreateIndex
CREATE INDEX "messages_conversationId_createdAt_idx" ON "public"."messages"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "messages_workspaceId_idx" ON "public"."messages"("workspaceId");

-- CreateIndex
CREATE INDEX "messages_conversationId_idx" ON "public"."messages"("conversationId");

-- CreateIndex
CREATE INDEX "messages_visibleTo_idx" ON "public"."messages"("visibleTo");

-- CreateIndex
CREATE INDEX "messages_conversationId_visibleTo_idx" ON "public"."messages"("conversationId", "visibleTo");

-- CreateIndex
CREATE INDEX "messages_senderId_idx" ON "public"."messages"("senderId");

-- CreateIndex
CREATE INDEX "messages_msgType_createdAt_idx" ON "public"."messages"("msgType", "createdAt");

-- CreateIndex
CREATE INDEX "messages_conversationId_createdAt_messageId_idx" ON "public"."messages"("conversationId", "createdAt", "messageId");

-- CreateIndex
CREATE INDEX "messages_conversationId_messageId_idx" ON "public"."messages"("conversationId", "messageId");

-- CreateIndex
CREATE UNIQUE INDEX "message_artifacts_messageId_key" ON "public"."message_artifacts"("messageId");

-- CreateIndex
CREATE INDEX "message_artifacts_workspaceId_status_messageCreatedAt_idx" ON "public"."message_artifacts"("workspaceId", "status", "messageCreatedAt");

-- CreateIndex
CREATE INDEX "message_artifacts_channelId_idx" ON "public"."message_artifacts"("channelId");

-- CreateIndex
CREATE INDEX "message_attachments_entityType_idx" ON "public"."message_attachments"("entityType");

-- CreateIndex
CREATE INDEX "message_attachments_conversationId_idx" ON "public"."message_attachments"("conversationId");

-- CreateIndex
CREATE INDEX "message_attachments_entityId_idx" ON "public"."message_attachments"("entityId");

-- CreateIndex
CREATE INDEX "message_attachments_entityId_id_idx" ON "public"."message_attachments"("entityId", "id");

-- CreateIndex
CREATE INDEX "message_attachments_entityId_position_idx" ON "public"."message_attachments"("entityId", "position");

-- CreateIndex
CREATE INDEX "reactions_messageId_idx" ON "public"."reactions"("messageId");

-- CreateIndex
CREATE INDEX "reactions_messageId_reactionId_idx" ON "public"."reactions"("messageId", "reactionId");

-- CreateIndex
CREATE UNIQUE INDEX "reactions_messageId_userId_emojiName_key" ON "public"."reactions"("messageId", "userId", "emojiName");

-- CreateIndex
CREATE INDEX "reaction_counts_messageId_idx" ON "public"."reaction_counts"("messageId");

-- CreateIndex
CREATE INDEX "reaction_counts_messageId_countId_idx" ON "public"."reaction_counts"("messageId", "countId");

-- CreateIndex
CREATE UNIQUE INDEX "reaction_counts_messageId_emojiName_key" ON "public"."reaction_counts"("messageId", "emojiName");

-- CreateIndex
CREATE INDEX "custom_emojis_createdAt_id_idx" ON "public"."custom_emojis"("createdAt" DESC, "id");

-- CreateIndex
CREATE UNIQUE INDEX "custom_emojis_name_key" ON "public"."custom_emojis"("name");

-- CreateIndex
CREATE INDEX "activities_userId_createdAt_id_idx" ON "public"."activities"("userId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "activities_workspaceId_idx" ON "public"."activities"("workspaceId");

-- CreateIndex
CREATE INDEX "activities_userId_actorAction_createdAt_id_idx" ON "public"."activities"("userId", "actorAction", "createdAt", "id");

-- CreateIndex
CREATE INDEX "activities_userId_classification_createdAt_id_idx" ON "public"."activities"("userId", "classification", "createdAt", "id");

-- CreateIndex
CREATE INDEX "activities_userId_actorAction_classification_createdAt_id_idx" ON "public"."activities"("userId", "actorAction", "classification", "createdAt", "id");

-- CreateIndex
CREATE INDEX "activities_userId_actorAction_isRead_idx" ON "public"."activities"("userId", "actorAction", "isRead");

-- CreateIndex
CREATE INDEX "activities_userId_isRead_createdAt_idx" ON "public"."activities"("userId", "isRead", "createdAt");

-- CreateIndex
CREATE INDEX "activities_userId_isRead_actionSource_idx" ON "public"."activities"("userId", "isRead", "actionSource");

-- CreateIndex
CREATE INDEX "activities_userId_isRead_isThreadActivity_idx" ON "public"."activities"("userId", "isRead", "isThreadActivity");

-- CreateIndex
CREATE INDEX "activities_userId_createdAt_idx" ON "public"."activities"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "activities_userId_updatedAt_idx" ON "public"."activities"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "activities_userId_classification_createdAt_idx" ON "public"."activities"("userId", "classification", "createdAt");

-- CreateIndex
CREATE INDEX "activities_classification_classificationJobType_createdAt_idx" ON "public"."activities"("classification", "classificationJobType", "createdAt");

-- CreateIndex
CREATE INDEX "activities_classificationJobType_actionSourceId_channelId_c_idx" ON "public"."activities"("classificationJobType", "actionSourceId", "channelId", "classification");

-- CreateIndex
CREATE INDEX "activities_actionSource_actionSourceId_idx" ON "public"."activities"("actionSource", "actionSourceId");

-- CreateIndex
CREATE INDEX "activities_messageId_idx" ON "public"."activities"("messageId");

-- CreateIndex
CREATE INDEX "activities_reactionId_idx" ON "public"."activities"("reactionId");

-- CreateIndex
CREATE INDEX "activities_callId_idx" ON "public"."activities"("callId");

-- CreateIndex
CREATE INDEX "activities_ticketId_idx" ON "public"."activities"("ticketId");

-- CreateIndex
CREATE INDEX "activities_channelId_idx" ON "public"."activities"("channelId");

-- CreateIndex
CREATE INDEX "activities_conversationId_userId_idx" ON "public"."activities"("conversationId", "userId");

-- CreateIndex
CREATE INDEX "activities_actorId_idx" ON "public"."activities"("actorId");

-- CreateIndex
CREATE INDEX "activities_userId_updatedAt_id_idx" ON "public"."activities"("userId", "updatedAt" DESC, "id");

-- CreateIndex
CREATE INDEX "activities_userId_actorAction_isRead_id_idx" ON "public"."activities"("userId", "actorAction", "isRead", "id");

-- CreateIndex
CREATE INDEX "user_external_tokens_provider_idx" ON "non_zero"."user_external_tokens"("provider");

-- CreateIndex
CREATE INDEX "user_external_tokens_userId_idx" ON "non_zero"."user_external_tokens"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_external_tokens_userId_provider_key" ON "non_zero"."user_external_tokens"("userId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "external_sources_name_key" ON "workflow"."external_sources"("name");

-- CreateIndex
CREATE INDEX "external_sources_workspaceId_sourceType_idx" ON "workflow"."external_sources"("workspaceId", "sourceType");

-- CreateIndex
CREATE INDEX "external_sources_boardId_idx" ON "workflow"."external_sources"("boardId");

-- CreateIndex
CREATE INDEX "external_sources_ownerUserId_idx" ON "workflow"."external_sources"("ownerUserId");

-- CreateIndex
CREATE INDEX "external_sources_displayName_idx" ON "workflow"."external_sources"("displayName");

-- CreateIndex
CREATE INDEX "external_sources_channelId_idx" ON "workflow"."external_sources"("channelId");

-- CreateIndex
CREATE INDEX "external_sources_externalIdentifier_idx" ON "workflow"."external_sources"("externalIdentifier");

-- CreateIndex
CREATE INDEX "external_messages_externalSourceId_externalThreadId_idx" ON "workflow"."external_messages"("externalSourceId", "externalThreadId");

-- CreateIndex
CREATE INDEX "external_messages_messageId_idx" ON "workflow"."external_messages"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "external_messages_externalSourceId_externalId_key" ON "workflow"."external_messages"("externalSourceId", "externalId");

-- CreateIndex
CREATE INDEX "proactive_nudges_state_idx" ON "public"."proactive_nudges"("state");

-- CreateIndex
CREATE UNIQUE INDEX "proactive_nudges_messageId_key" ON "public"."proactive_nudges"("messageId");

-- CreateIndex
CREATE INDEX "surface_nudges_sourceId_state_idx" ON "public"."surface_nudges"("sourceId", "state");

-- CreateIndex
CREATE INDEX "surface_nudges_surfaceNudgeCountId_state_idx" ON "public"."surface_nudges"("surfaceNudgeCountId", "state");

-- CreateIndex
CREATE INDEX "surface_nudges_createdAt_idx" ON "public"."surface_nudges"("createdAt");

-- CreateIndex
CREATE INDEX "surface_nudge_counts_messageId_userId_idx" ON "public"."surface_nudge_counts"("messageId", "userId");

-- CreateIndex
CREATE INDEX "surface_nudge_counts_messageId_channelId_idx" ON "public"."surface_nudge_counts"("messageId", "channelId");

-- CreateIndex
CREATE INDEX "surface_nudge_counts_messageId_gid_gidType_idx" ON "public"."surface_nudge_counts"("messageId", "gid", "gidType");

-- CreateIndex
CREATE INDEX "surface_nudge_counts_ticketId_userId_idx" ON "public"."surface_nudge_counts"("ticketId", "userId");

-- CreateIndex
CREATE INDEX "surface_nudge_counts_ticketId_channelId_idx" ON "public"."surface_nudge_counts"("ticketId", "channelId");

-- CreateIndex
CREATE INDEX "surface_nudge_counts_ticketId_gid_gidType_idx" ON "public"."surface_nudge_counts"("ticketId", "gid", "gidType");

-- CreateIndex
CREATE INDEX "surface_nudge_counts_canvasId_userId_idx" ON "public"."surface_nudge_counts"("canvasId", "userId");

-- CreateIndex
CREATE INDEX "surface_nudge_counts_canvasId_channelId_idx" ON "public"."surface_nudge_counts"("canvasId", "channelId");

-- CreateIndex
CREATE INDEX "surface_nudge_counts_canvasId_gid_gidType_idx" ON "public"."surface_nudge_counts"("canvasId", "gid", "gidType");

-- CreateIndex
CREATE INDEX "surface_nudge_counts_callId_userId_idx" ON "public"."surface_nudge_counts"("callId", "userId");

-- CreateIndex
CREATE INDEX "surface_nudge_counts_callId_channelId_idx" ON "public"."surface_nudge_counts"("callId", "channelId");

-- CreateIndex
CREATE INDEX "surface_nudge_counts_callId_gid_gidType_idx" ON "public"."surface_nudge_counts"("callId", "gid", "gidType");

-- CreateIndex
CREATE INDEX "surface_nudge_counts_conversationId_userId_idx" ON "public"."surface_nudge_counts"("conversationId", "userId");

-- CreateIndex
CREATE INDEX "surface_nudge_counts_conversationId_channelId_idx" ON "public"."surface_nudge_counts"("conversationId", "channelId");

-- CreateIndex
CREATE INDEX "surface_nudge_counts_conversationId_gid_gidType_idx" ON "public"."surface_nudge_counts"("conversationId", "gid", "gidType");

-- CreateIndex
CREATE INDEX "notifications_userId_status_idx" ON "workflow"."notifications"("userId", "status");

-- CreateIndex
CREATE INDEX "notifications_type_idx" ON "workflow"."notifications"("type");

-- CreateIndex
CREATE INDEX "notifications_relatedEntityType_relatedEntityId_idx" ON "workflow"."notifications"("relatedEntityType", "relatedEntityId");

-- CreateIndex
CREATE INDEX "notifications_createdAt_idx" ON "workflow"."notifications"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_userId_notificationType_key" ON "public"."notification_preferences"("userId", "notificationType");

-- CreateIndex
CREATE UNIQUE INDEX "browser_notification_subscriptions_endpoint_key" ON "workflow"."browser_notification_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "browser_notification_subscriptions_userId_idx" ON "workflow"."browser_notification_subscriptions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "calls_externalId_key" ON "public"."calls"("externalId");

-- CreateIndex
CREATE INDEX "calls_externalId_idx" ON "public"."calls"("externalId");

-- CreateIndex
CREATE INDEX "calls_createdByUserId_idx" ON "public"."calls"("createdByUserId");

-- CreateIndex
CREATE INDEX "calls_organizerId_idx" ON "public"."calls"("organizerId");

-- CreateIndex
CREATE INDEX "calls_channelId_idx" ON "public"."calls"("channelId");

-- CreateIndex
CREATE INDEX "calls_status_lastActivityAt_idx" ON "public"."calls"("status", "lastActivityAt");

-- CreateIndex
CREATE INDEX "calls_startsAt_idx" ON "public"."calls"("startsAt");

-- CreateIndex
CREATE INDEX "calls_recurringSeriesId_idx" ON "public"."calls"("recurringSeriesId");

-- CreateIndex
CREATE INDEX "calls_isRecurring_idx" ON "public"."calls"("isRecurring");

-- CreateIndex
CREATE INDEX "calls_instanceDate_idx" ON "public"."calls"("instanceDate");

-- CreateIndex
CREATE INDEX "calls_orgName_idx" ON "public"."calls"("orgName");

-- CreateIndex
CREATE INDEX "calls_summaryTemplateId_idx" ON "public"."calls"("summaryTemplateId");

-- CreateIndex
CREATE INDEX "calls_status_startedAt_externalId_idx" ON "public"."calls"("status", "startedAt" DESC, "externalId");

-- CreateIndex
CREATE INDEX "calls_status_startsAt_externalId_idx" ON "public"."calls"("status", "startsAt", "externalId");

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
CREATE INDEX "call_participants_callId_idx" ON "public"."call_participants"("callId");

-- CreateIndex
CREATE INDEX "call_participants_userId_idx" ON "public"."call_participants"("userId");

-- CreateIndex
CREATE INDEX "call_participants_email_idx" ON "public"."call_participants"("email");

-- CreateIndex
CREATE INDEX "call_participants_callId_leftAt_idx" ON "public"."call_participants"("callId", "leftAt");

-- CreateIndex
CREATE INDEX "call_participants_response_idx" ON "public"."call_participants"("response");

-- CreateIndex
CREATE UNIQUE INDEX "call_participants_callId_userId_key" ON "public"."call_participants"("callId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "call_participants_callId_email_key" ON "public"."call_participants"("callId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "call_recordings_egressId_key" ON "non_zero"."call_recordings"("egressId");

-- CreateIndex
CREATE INDEX "call_recordings_callId_idx" ON "non_zero"."call_recordings"("callId");

-- CreateIndex
CREATE INDEX "recurring_call_series_organizerId_idx" ON "public"."recurring_call_series"("organizerId");

-- CreateIndex
CREATE INDEX "recurring_call_series_channelId_idx" ON "public"."recurring_call_series"("channelId");

-- CreateIndex
CREATE INDEX "recurring_call_series_status_idx" ON "public"."recurring_call_series"("status");

-- CreateIndex
CREATE INDEX "recurring_call_participants_recurringSeriesId_idx" ON "public"."recurring_call_participants"("recurringSeriesId");

-- CreateIndex
CREATE INDEX "recurring_call_participants_userId_idx" ON "public"."recurring_call_participants"("userId");

-- CreateIndex
CREATE INDEX "recurring_call_participants_email_idx" ON "public"."recurring_call_participants"("email");

-- CreateIndex
CREATE INDEX "recurring_call_participants_isExternal_idx" ON "public"."recurring_call_participants"("isExternal");

-- CreateIndex
CREATE UNIQUE INDEX "recurring_call_participants_recurringSeriesId_userId_key" ON "public"."recurring_call_participants"("recurringSeriesId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "recurring_call_participants_recurringSeriesId_email_key" ON "public"."recurring_call_participants"("recurringSeriesId", "email");

-- CreateIndex
CREATE INDEX "canvas_folders_projectId_idx" ON "public"."canvas_folders"("projectId");

-- CreateIndex
CREATE INDEX "canvas_folders_channelId_idx" ON "public"."canvas_folders"("channelId");

-- CreateIndex
CREATE INDEX "canvas_folders_projectId_channelId_idx" ON "public"."canvas_folders"("projectId", "channelId");

-- CreateIndex
CREATE INDEX "canvas_folders_createdBy_idx" ON "public"."canvas_folders"("createdBy");

-- CreateIndex
CREATE UNIQUE INDEX "canvas_folders_projectId_channelId_name_key" ON "public"."canvas_folders"("projectId", "channelId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "canvases_viewAccessId_key" ON "public"."canvases"("viewAccessId");

-- CreateIndex
CREATE UNIQUE INDEX "canvases_editAccessId_key" ON "public"."canvases"("editAccessId");

-- CreateIndex
CREATE INDEX "canvases_createdBy_idx" ON "public"."canvases"("createdBy");

-- CreateIndex
CREATE INDEX "canvases_channelId_idx" ON "public"."canvases"("channelId");

-- CreateIndex
CREATE INDEX "canvases_folderId_idx" ON "public"."canvases"("folderId");

-- CreateIndex
CREATE INDEX "canvases_projectId_idx" ON "public"."canvases"("projectId");

-- CreateIndex
CREATE INDEX "canvases_visibility_idx" ON "public"."canvases"("visibility");

-- CreateIndex
CREATE INDEX "canvases_isTemplate_idx" ON "public"."canvases"("isTemplate");

-- CreateIndex
CREATE INDEX "canvases_viewAccessId_idx" ON "public"."canvases"("viewAccessId");

-- CreateIndex
CREATE INDEX "canvases_editAccessId_idx" ON "public"."canvases"("editAccessId");

-- CreateIndex
CREATE INDEX "canvases_docType_idx" ON "public"."canvases"("docType");

-- CreateIndex
CREATE INDEX "canvases_createdBy_updatedAt_id_idx" ON "public"."canvases"("createdBy", "updatedAt" DESC, "id");

-- CreateIndex
CREATE INDEX "canvases_docType_updatedAt_id_idx" ON "public"."canvases"("docType", "updatedAt" DESC, "id");

-- CreateIndex
CREATE UNIQUE INDEX "canvases_userRepo_key" ON "public"."canvases"("userRepo");

-- CreateIndex
CREATE UNIQUE INDEX "canvases_repoId_branchName_key" ON "public"."canvases"("repoId", "branchName");

-- CreateIndex
CREATE INDEX "canvas_versions_canvasId_updatedAt_idx" ON "public"."canvas_versions"("canvasId", "updatedAt");

-- CreateIndex
CREATE INDEX "canvas_versions_createdBy_idx" ON "public"."canvas_versions"("createdBy");

-- CreateIndex
CREATE UNIQUE INDEX "canvas_versions_canvasId_contentHash_key" ON "public"."canvas_versions"("canvasId", "contentHash");

-- CreateIndex
CREATE INDEX "canvas_comment_threads_workspaceId_canvasId_createdAt_idx" ON "public"."canvas_comment_threads"("workspaceId", "canvasId", "createdAt");

-- CreateIndex
CREATE INDEX "canvas_comments_workspaceId_threadId_createdAt_idx" ON "public"."canvas_comments"("workspaceId", "threadId", "createdAt");

-- CreateIndex
CREATE INDEX "canvas_participants_canvasId_idx" ON "public"."canvas_participants"("canvasId");

-- CreateIndex
CREATE INDEX "canvas_participants_userId_idx" ON "public"."canvas_participants"("userId");

-- CreateIndex
CREATE INDEX "canvas_participants_userGroupId_idx" ON "public"."canvas_participants"("userGroupId");

-- CreateIndex
CREATE INDEX "canvas_participants_channelId_idx" ON "public"."canvas_participants"("channelId");

-- CreateIndex
CREATE UNIQUE INDEX "canvas_participants_canvasId_userId_key" ON "public"."canvas_participants"("canvasId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "canvas_participants_canvasId_userGroupId_key" ON "public"."canvas_participants"("canvasId", "userGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "canvas_participants_canvasId_channelId_key" ON "public"."canvas_participants"("canvasId", "channelId");

-- CreateIndex
CREATE INDEX "canvas_user_status_canvasId_idx" ON "public"."canvas_user_status"("canvasId");

-- CreateIndex
CREATE INDEX "canvas_user_status_userId_idx" ON "public"."canvas_user_status"("userId");

-- CreateIndex
CREATE INDEX "canvas_user_status_userId_isStarred_idx" ON "public"."canvas_user_status"("userId", "isStarred");

-- CreateIndex
CREATE UNIQUE INDEX "canvas_user_status_canvasId_userId_key" ON "public"."canvas_user_status"("canvasId", "userId");

-- CreateIndex
CREATE INDEX "bookmarks_userId_entityType_idx" ON "public"."bookmarks"("userId", "entityType");

-- CreateIndex
CREATE INDEX "bookmarks_userId_createdAt_idx" ON "public"."bookmarks"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "bookmarks_userId_isCompleted_updatedAt_idx" ON "public"."bookmarks"("userId", "isCompleted", "updatedAt");

-- CreateIndex
CREATE INDEX "bookmarks_userId_createdAt_id_idx" ON "public"."bookmarks"("userId", "createdAt" DESC, "id");

-- CreateIndex
CREATE UNIQUE INDEX "bookmarks_userId_entityId_entityType_key" ON "public"."bookmarks"("userId", "entityId", "entityType");

-- CreateIndex
CREATE INDEX "links_createdBy_url_channelId_idx" ON "public"."links"("createdBy", "url", "channelId");

-- CreateIndex
CREATE INDEX "links_channelId_visibility_idx" ON "public"."links"("channelId", "visibility");

-- CreateIndex
CREATE INDEX "links_channelId_createdBy_idx" ON "public"."links"("channelId", "createdBy");

-- CreateIndex
CREATE INDEX "link_access_userId_idx" ON "public"."link_access"("userId");

-- CreateIndex
CREATE INDEX "link_access_linkId_idx" ON "public"."link_access"("linkId");

-- CreateIndex
CREATE UNIQUE INDEX "link_access_linkId_userId_key" ON "public"."link_access"("linkId", "userId");

-- CreateIndex
CREATE INDEX "vespa_insertion_logs_entityId_idx" ON "workflow"."vespa_insertion_logs"("entityId");

-- CreateIndex
CREATE INDEX "vespa_insertion_logs_entityType_idx" ON "workflow"."vespa_insertion_logs"("entityType");

-- CreateIndex
CREATE INDEX "vespa_insertion_logs_userId_idx" ON "workflow"."vespa_insertion_logs"("userId");

-- CreateIndex
CREATE INDEX "vespa_insertion_logs_status_idx" ON "workflow"."vespa_insertion_logs"("status");

-- CreateIndex
CREATE INDEX "vespa_insertion_logs_type_idx" ON "workflow"."vespa_insertion_logs"("type");

-- CreateIndex
CREATE INDEX "vespa_insertion_logs_entityId_entityType_idx" ON "workflow"."vespa_insertion_logs"("entityId", "entityType");

-- CreateIndex
CREATE UNIQUE INDEX "repos_sdlcSetupExecutionId_key" ON "public"."repos"("sdlcSetupExecutionId");

-- CreateIndex
CREATE INDEX "repos_name_idx" ON "public"."repos"("name");

-- CreateIndex
CREATE INDEX "repos_projectId_idx" ON "public"."repos"("projectId");

-- CreateIndex
CREATE INDEX "repos_workspaceId_projectId_idx" ON "public"."repos"("workspaceId", "projectId");

-- CreateIndex
CREATE INDEX "repos_vcsCredentialId_idx" ON "public"."repos"("vcsCredentialId");

-- CreateIndex
CREATE UNIQUE INDEX "repos_url_createdBy_key" ON "public"."repos"("url", "createdBy");

-- CreateIndex
CREATE UNIQUE INDEX "repos_workspaceId_canonicalUrl_key" ON "public"."repos"("workspaceId", "canonicalUrl");

-- CreateIndex
CREATE INDEX "sdlc_entity_links_workspaceId_idx" ON "public"."sdlc_entity_links"("workspaceId");

-- CreateIndex
CREATE INDEX "sdlc_entity_links_channelId_relationType_idx" ON "public"."sdlc_entity_links"("channelId", "relationType");

-- CreateIndex
CREATE INDEX "sdlc_entity_links_sourceType_sourceId_relationType_idx" ON "public"."sdlc_entity_links"("sourceType", "sourceId", "relationType");

-- CreateIndex
CREATE INDEX "sdlc_entity_links_targetType_targetId_relationType_idx" ON "public"."sdlc_entity_links"("targetType", "targetId", "relationType");

-- CreateIndex
CREATE INDEX "sdlc_entity_links_workspaceId_repoId_idx" ON "public"."sdlc_entity_links"("workspaceId", "repoId");

-- CreateIndex
CREATE INDEX "sdlc_entity_links_repoId_sourceType_sourceId_idx" ON "public"."sdlc_entity_links"("repoId", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "sdlc_entity_links_repoId_targetType_targetId_idx" ON "public"."sdlc_entity_links"("repoId", "targetType", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "sdlc_entity_links_channel_edge_key" ON "public"."sdlc_entity_links"("channelId", "sourceType", "sourceId", "targetType", "targetId", "relationType");

-- CreateIndex
CREATE UNIQUE INDEX "sdlc_entity_links_repoId_sourceType_sourceId_targetType_tar_key" ON "public"."sdlc_entity_links"("repoId", "sourceType", "sourceId", "targetType", "targetId", "relationType");

-- CreateIndex
CREATE INDEX "sdlc_item_comments_entityType_entityId_createdAt_idx" ON "public"."sdlc_item_comments"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "sdlc_item_comments_workspaceId_idx" ON "public"."sdlc_item_comments"("workspaceId");

-- CreateIndex
CREATE INDEX "sdlc_artifacts_repoId_idx" ON "public"."sdlc_artifacts"("repoId");

-- CreateIndex
CREATE INDEX "sdlc_artifacts_workflowExecutionId_idx" ON "public"."sdlc_artifacts"("workflowExecutionId");

-- CreateIndex
CREATE INDEX "sdlc_artifacts_workspaceId_idx" ON "public"."sdlc_artifacts"("workspaceId");

-- CreateIndex
CREATE INDEX "sdlc_artifacts_artifactType_artifactStatus_idx" ON "public"."sdlc_artifacts"("artifactType", "artifactStatus");

-- CreateIndex
CREATE INDEX "sdlc_folders_workspaceId_idx" ON "public"."sdlc_folders"("workspaceId");

-- CreateIndex
CREATE INDEX "sdlc_tracks_repoId_status_idx" ON "public"."sdlc_tracks"("repoId", "status");

-- CreateIndex
CREATE INDEX "sdlc_tracks_workspaceId_idx" ON "public"."sdlc_tracks"("workspaceId");

-- CreateIndex
CREATE INDEX "lookup_values_type_idx" ON "public"."lookup_values"("type");

-- CreateIndex
CREATE UNIQUE INDEX "lookup_values_type_value_key" ON "public"."lookup_values"("type", "value");

-- CreateIndex
CREATE INDEX "forms_createdBy_idx" ON "public"."forms"("createdBy");

-- CreateIndex
CREATE INDEX "forms_entityType_contextType_idx" ON "public"."forms"("entityType", "contextType");

-- CreateIndex
CREATE INDEX "forms_workspaceId_createdAt_id_idx" ON "public"."forms"("workspaceId", "createdAt" DESC, "id");

-- CreateIndex
CREATE INDEX "forms_context_mapping_contextId_contextType_idx" ON "public"."forms_context_mapping"("contextId", "contextType");

-- CreateIndex
CREATE UNIQUE INDEX "forms_context_mapping_contextId_contextType_formId_key" ON "public"."forms_context_mapping"("contextId", "contextType", "formId");

-- CreateIndex
CREATE UNIQUE INDEX "forms_context_mapping_contextId_entityType_key" ON "public"."forms_context_mapping"("contextId", "entityType");

-- CreateIndex
CREATE INDEX "global_fields_projectId_idx" ON "public"."global_fields"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "global_fields_projectId_fieldName_fieldType_key" ON "public"."global_fields"("projectId", "fieldName", "fieldType");

-- CreateIndex
CREATE INDEX "form_fields_formId_idx" ON "public"."form_fields"("formId");

-- CreateIndex
CREATE INDEX "form_fields_globalFieldId_idx" ON "public"."form_fields"("globalFieldId");

-- CreateIndex
CREATE INDEX "form_fields_parentOptionId_idx" ON "public"."form_fields"("parentOptionId");

-- CreateIndex
CREATE UNIQUE INDEX "form_fields_formId_fieldName_key" ON "public"."form_fields"("formId", "fieldName");

-- CreateIndex
CREATE UNIQUE INDEX "form_fields_formId_globalFieldId_key" ON "public"."form_fields"("formId", "globalFieldId");

-- CreateIndex
CREATE INDEX "form_entity_values_entityId_entityType_idx" ON "public"."form_entity_values"("entityId", "entityType");

-- CreateIndex
CREATE INDEX "form_entity_values_fieldId_idx" ON "public"."form_entity_values"("fieldId");

-- CreateIndex
CREATE INDEX "form_entity_values_contextId_idx" ON "public"."form_entity_values"("contextId");

-- CreateIndex
CREATE UNIQUE INDEX "form_entity_values_entityId_entityType_fieldId_contextId_ve_key" ON "public"."form_entity_values"("entityId", "entityType", "fieldId", "contextId", "version");

-- CreateIndex
CREATE INDEX "dashboard_queries_mapping_dashboardId_idx" ON "public"."dashboard_queries_mapping"("dashboardId");

-- CreateIndex
CREATE UNIQUE INDEX "merchants_mid_key" ON "public"."merchants"("mid");

-- CreateIndex
CREATE INDEX "merchants_mid_id_idx" ON "public"."merchants"("mid", "id");

-- CreateIndex
CREATE INDEX "draft_messages_channelId_conversationId_messageId_userId_idx" ON "public"."draft_messages"("channelId", "conversationId", "messageId", "userId");

-- CreateIndex
CREATE INDEX "draft_messages_userId_id_idx" ON "public"."draft_messages"("userId", "id");

-- CreateIndex
CREATE INDEX "draft_messages_userId_origin_idx" ON "public"."draft_messages"("userId", "origin");

-- CreateIndex
CREATE INDEX "user_activity_events_userId_idx" ON "workflow"."user_activity_events"("userId");

-- CreateIndex
CREATE INDEX "user_activity_events_eventCategory_idx" ON "workflow"."user_activity_events"("eventCategory");

-- CreateIndex
CREATE INDEX "user_activity_events_eventName_idx" ON "workflow"."user_activity_events"("eventName");

-- CreateIndex
CREATE INDEX "user_activity_events_timestamp_idx" ON "workflow"."user_activity_events"("timestamp");

-- CreateIndex
CREATE INDEX "activity_aliases_eventName_idx" ON "workflow"."activity_aliases"("eventName");

-- CreateIndex
CREATE INDEX "activity_aliases_eventCategory_idx" ON "workflow"."activity_aliases"("eventCategory");

-- CreateIndex
CREATE UNIQUE INDEX "activity_aliases_eventName_eventCategory_key" ON "workflow"."activity_aliases"("eventName", "eventCategory");

-- CreateIndex
CREATE INDEX "idx_collections_id_owner" ON "public"."collections"("id", "ownerId");

-- CreateIndex
CREATE INDEX "idx_collections_deleted_created_id" ON "public"."collections"("deletedAt", "createdAt", "id");

-- CreateIndex
CREATE INDEX "idx_collections_parent_deleted" ON "public"."collections"("parentId", "deletedAt");

-- CreateIndex
CREATE INDEX "idx_collections_root_collection_deleted" ON "public"."collections"("rootCollectionId", "deletedAt");

-- CreateIndex
CREATE INDEX "idx_collections_scope_deleted" ON "public"."collections"("scopeType", "scopeId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "unique_collection_parent_name" ON "public"."collections"("parentId", "name");

-- CreateIndex
CREATE INDEX "idx_items_file_id" ON "public"."collection_items"("fileId");

-- CreateIndex
CREATE INDEX "idx_items_root_collection_latest" ON "public"."collection_items"("rootCollectionId", "isLatest", "deletedAt", "createdAt", "id");

-- CreateIndex
CREATE INDEX "idx_items_collection_latest" ON "public"."collection_items"("collectionId", "isLatest", "deletedAt", "createdAt", "id");

-- CreateIndex
CREATE INDEX "collection_permissions_userGroupId_idx" ON "public"."collection_permissions"("userGroupId");

-- CreateIndex
CREATE INDEX "collection_permissions_channelId_idx" ON "public"."collection_permissions"("channelId");

-- CreateIndex
CREATE INDEX "idx_collection_permissions_collection_user_id" ON "public"."collection_permissions"("collectionId", "userId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "collection_permissions_collectionId_userId_key" ON "public"."collection_permissions"("collectionId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "collection_permissions_collectionId_userGroupId_key" ON "public"."collection_permissions"("collectionId", "userGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "collection_permissions_collectionId_channelId_key" ON "public"."collection_permissions"("collectionId", "channelId");

-- CreateIndex
CREATE INDEX "stage_approvers_stageId_idx" ON "public"."stage_approvers"("stageId");

-- CreateIndex
CREATE INDEX "stage_approvers_transitionId_idx" ON "public"."stage_approvers"("transitionId");

-- CreateIndex
CREATE UNIQUE INDEX "stage_approvers_stageId_userId_approverType_key" ON "public"."stage_approvers"("stageId", "userId", "approverType");

-- CreateIndex
CREATE UNIQUE INDEX "stage_approvers_transitionId_userId_approverType_key" ON "public"."stage_approvers"("transitionId", "userId", "approverType");

-- CreateIndex
CREATE UNIQUE INDEX "stage_approvers_stageId_roleId_approverType_key" ON "public"."stage_approvers"("stageId", "roleId", "approverType");

-- CreateIndex
CREATE UNIQUE INDEX "stage_approvers_transitionId_roleId_approverType_key" ON "public"."stage_approvers"("transitionId", "roleId", "approverType");

-- CreateIndex
CREATE UNIQUE INDEX "applications_boardId_key" ON "public"."applications"("boardId");

-- CreateIndex
CREATE INDEX "applications_projectId_idx" ON "public"."applications"("projectId");

-- CreateIndex
CREATE INDEX "applications_channelId_idx" ON "public"."applications"("channelId");

-- CreateIndex
CREATE INDEX "applications_boardId_idx" ON "public"."applications"("boardId");

-- CreateIndex
CREATE INDEX "applications_mainReleaseBoardId_idx" ON "public"."applications"("mainReleaseBoardId");

-- CreateIndex
CREATE UNIQUE INDEX "applications_mainReleaseBoardId_name_key" ON "public"."applications"("mainReleaseBoardId", "name");

-- CreateIndex
CREATE INDEX "application_release_tickets_applicationReleaseId_idx" ON "public"."application_release_tickets"("applicationReleaseId");

-- CreateIndex
CREATE INDEX "application_release_tickets_ticketId_idx" ON "public"."application_release_tickets"("ticketId");

-- CreateIndex
CREATE INDEX "application_release_tickets_releaseId_createdAt_id_idx" ON "public"."application_release_tickets"("releaseId", "createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "application_release_tickets_applicationReleaseId_ticketId_key" ON "public"."application_release_tickets"("applicationReleaseId", "ticketId");

-- CreateIndex
CREATE INDEX "release_repositories_releaseId_idx" ON "non_zero"."release_repositories"("releaseId");

-- CreateIndex
CREATE INDEX "release_repositories_releaseId_createdAt_id_idx" ON "non_zero"."release_repositories"("releaseId", "createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "release_repositories_releaseId_mainReleaseBoardId_key" ON "non_zero"."release_repositories"("releaseId", "mainReleaseBoardId");

-- CreateIndex
CREATE INDEX "release_events_releaseId_idx" ON "public"."release_events"("releaseId");

-- CreateIndex
CREATE INDEX "release_events_applicationReleaseId_idx" ON "public"."release_events"("applicationReleaseId");

-- CreateIndex
CREATE INDEX "release_events_channelId_conversationId_idx" ON "public"."release_events"("channelId", "conversationId");

-- CreateIndex
CREATE INDEX "release_events_eventType_idx" ON "public"."release_events"("eventType");

-- CreateIndex
CREATE INDEX "release_events_createdAt_idx" ON "public"."release_events"("createdAt");

-- CreateIndex
CREATE INDEX "release_events_releaseId_createdAt_id_idx" ON "public"."release_events"("releaseId", "createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "release_changes_releaseId_idx" ON "public"."release_changes"("releaseId");

-- CreateIndex
CREATE INDEX "release_changes_applicationReleaseId_idx" ON "public"."release_changes"("applicationReleaseId");

-- CreateIndex
CREATE INDEX "release_changes_applicationId_idx" ON "public"."release_changes"("applicationId");

-- CreateIndex
CREATE INDEX "release_change_types_id_idx" ON "public"."release_change_types"("id");

-- CreateIndex
CREATE INDEX "release_change_types_applicationId_idx" ON "public"."release_change_types"("applicationId");

-- CreateIndex
CREATE INDEX "release_change_types_changeType_idx" ON "public"."release_change_types"("changeType");

-- CreateIndex
CREATE INDEX "release_change_types_releaseId_idx" ON "public"."release_change_types"("releaseId");

-- CreateIndex
CREATE INDEX "release_change_types_applicationReleaseId_idx" ON "public"."release_change_types"("applicationReleaseId");

-- CreateIndex
CREATE INDEX "release_change_types_devTicketXyneId_idx" ON "public"."release_change_types"("devTicketXyneId");

-- CreateIndex
CREATE INDEX "ticket_stage_requests_ticketId_idx" ON "public"."ticket_stage_requests"("ticketId");

-- CreateIndex
CREATE INDEX "ticket_stage_requests_stageId_idx" ON "public"."ticket_stage_requests"("stageId");

-- CreateIndex
CREATE INDEX "ticket_stage_requests_formId_idx" ON "public"."ticket_stage_requests"("formId");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_stage_requests_ticketId_stageId_key" ON "public"."ticket_stage_requests"("ticketId", "stageId");

-- CreateIndex
CREATE INDEX "rcas_ticketId_idx" ON "public"."rcas"("ticketId");

-- CreateIndex
CREATE INDEX "rcas_ownerId_idx" ON "public"."rcas"("ownerId");

-- CreateIndex
CREATE INDEX "rcas_status_idx" ON "public"."rcas"("status");

-- CreateIndex
CREATE INDEX "impacts_ticketId_idx" ON "public"."impacts"("ticketId");

-- CreateIndex
CREATE INDEX "impacts_rcaId_idx" ON "public"."impacts"("rcaId");

-- CreateIndex
CREATE INDEX "impacts_impactTypeId_idx" ON "public"."impacts"("impactTypeId");

-- CreateIndex
CREATE INDEX "coes_rcaId_idx" ON "public"."coes"("rcaId");

-- CreateIndex
CREATE INDEX "coes_ownerId_idx" ON "public"."coes"("ownerId");

-- CreateIndex
CREATE INDEX "coes_status_idx" ON "public"."coes"("status");

-- CreateIndex
CREATE INDEX "coes_actionTypeId_idx" ON "public"."coes"("actionTypeId");

-- CreateIndex
CREATE INDEX "release_attributions_ticketId_idx" ON "public"."release_attributions"("ticketId");

-- CreateIndex
CREATE INDEX "release_attributions_releaseId_idx" ON "public"."release_attributions"("releaseId");

-- CreateIndex
CREATE INDEX "release_attributions_releaseApplicationId_idx" ON "public"."release_attributions"("releaseApplicationId");

-- CreateIndex
CREATE INDEX "release_attributions_rootCauseTicketId_idx" ON "public"."release_attributions"("rootCauseTicketId");

-- CreateIndex
CREATE INDEX "recaps_entityId_idx" ON "public"."recaps"("entityId");

-- CreateIndex
CREATE INDEX "recaps_recapDate_idx" ON "public"."recaps"("recapDate");

-- CreateIndex
CREATE INDEX "recaps_userId_idx" ON "public"."recaps"("userId");

-- CreateIndex
CREATE INDEX "recaps_entityType_idx" ON "public"."recaps"("entityType");

-- CreateIndex
CREATE INDEX "recaps_entityType_recapDate_entityId_idx" ON "public"."recaps"("entityType", "recapDate", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "recaps_entityType_entityId_userId_recapDate_key" ON "public"."recaps"("entityType", "entityId", "userId", "recapDate");

-- CreateIndex
CREATE INDEX "channel_daily_recaps_recapDate_idx" ON "public"."channel_daily_recaps"("recapDate");

-- CreateIndex
CREATE INDEX "channel_daily_recaps_userId_idx" ON "public"."channel_daily_recaps"("userId");

-- CreateIndex
CREATE INDEX "channel_recaps_recapDate_idx" ON "public"."channel_recaps"("recapDate");

-- CreateIndex
CREATE INDEX "channel_recaps_userId_idx" ON "public"."channel_recaps"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "session_recording_files_sessionId_key" ON "workflow"."session_recording_files"("sessionId");

-- CreateIndex
CREATE INDEX "session_recording_files_status_idx" ON "workflow"."session_recording_files"("status");

-- CreateIndex
CREATE INDEX "session_recording_files_sessionId_idx" ON "workflow"."session_recording_files"("sessionId");

-- CreateIndex
CREATE INDEX "surface_links_sourceType_sourceId_idx" ON "public"."surface_links"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "surface_links_targetType_targetId_idx" ON "public"."surface_links"("targetType", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "surface_links_sourceType_sourceId_targetType_targetId_linkK_key" ON "public"."surface_links"("sourceType", "sourceId", "targetType", "targetId", "linkKind");

-- CreateIndex
CREATE INDEX "apps_name_idx" ON "public"."apps"("name");

-- CreateIndex
CREATE INDEX "apps_createdBy_idx" ON "public"."apps"("createdBy");

-- CreateIndex
CREATE INDEX "apps_orgId_idx" ON "public"."apps"("orgId");

-- CreateIndex
CREATE INDEX "apps_scope_idx" ON "public"."apps"("scope");

-- CreateIndex
CREATE UNIQUE INDEX "apps_orgId_name_key" ON "public"."apps"("orgId", "name");

-- CreateIndex
CREATE INDEX "installed_apps_appId_idx" ON "public"."installed_apps"("appId");

-- CreateIndex
CREATE INDEX "installed_apps_userId_idx" ON "public"."installed_apps"("userId");

-- CreateIndex
CREATE INDEX "installed_app_commands_installedAppId_idx" ON "public"."installed_app_commands"("installedAppId");

-- CreateIndex
CREATE INDEX "app_incoming_webhooks_boardId_idx" ON "workflow"."app_incoming_webhooks"("boardId");

-- CreateIndex
CREATE INDEX "app_incoming_webhooks_installedAppId_channelId_idx" ON "workflow"."app_incoming_webhooks"("installedAppId", "channelId");

-- CreateIndex
CREATE INDEX "app_incoming_webhooks_installedAppId_idx" ON "workflow"."app_incoming_webhooks"("installedAppId");

-- CreateIndex
CREATE INDEX "app_incoming_webhooks_secret_idx" ON "workflow"."app_incoming_webhooks"("secret");

-- CreateIndex
CREATE INDEX "app_commands_appId_idx" ON "public"."app_commands"("appId");

-- CreateIndex
CREATE UNIQUE INDEX "app_commands_appId_commandName_key" ON "public"."app_commands"("appId", "commandName");

-- CreateIndex
CREATE INDEX "saved_user_configurations_contextType_contextId_idx" ON "public"."saved_user_configurations"("contextType", "contextId");

-- CreateIndex
CREATE INDEX "saved_user_configurations_userId_idx" ON "public"."saved_user_configurations"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "saved_user_configurations_userId_contextId_name_key" ON "public"."saved_user_configurations"("userId", "contextId", "name");

-- CreateIndex
CREATE INDEX "saved_user_configuration_values_configId_idx" ON "public"."saved_user_configuration_values"("configId");

-- CreateIndex
CREATE INDEX "view_access_viewId_idx" ON "public"."view_access"("viewId");

-- CreateIndex
CREATE INDEX "view_access_entityType_entityId_idx" ON "public"."view_access"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "delayed_messages_senderId_status_idx" ON "public"."delayed_messages"("senderId", "status");

-- CreateIndex
CREATE INDEX "delayed_messages_senderId_scheduledFor_idx" ON "public"."delayed_messages"("senderId", "scheduledFor");

-- CreateIndex
CREATE INDEX "delayed_messages_scheduledFor_status_idx" ON "public"."delayed_messages"("scheduledFor", "status");

-- CreateIndex
CREATE INDEX "delayed_messages_channelId_status_idx" ON "public"."delayed_messages"("channelId", "status");

-- CreateIndex
CREATE INDEX "data_sources_workspaceId_idx" ON "non_zero"."data_sources"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "data_sources_workspaceId_name_key" ON "non_zero"."data_sources"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "data_source_tables_dataSourceId_idx" ON "non_zero"."data_source_tables"("dataSourceId");

-- CreateIndex
CREATE UNIQUE INDEX "data_source_tables_dataSourceId_schemaName_tableName_key" ON "non_zero"."data_source_tables"("dataSourceId", "schemaName", "tableName");

-- CreateIndex
CREATE INDEX "data_source_columns_tableId_idx" ON "non_zero"."data_source_columns"("tableId");

-- CreateIndex
CREATE UNIQUE INDEX "data_source_columns_tableId_columnName_key" ON "non_zero"."data_source_columns"("tableId", "columnName");

-- CreateIndex
CREATE INDEX "data_source_relationships_dataSourceId_idx" ON "non_zero"."data_source_relationships"("dataSourceId");

-- CreateIndex
CREATE INDEX "data_source_relationships_fromColumnId_idx" ON "non_zero"."data_source_relationships"("fromColumnId");

-- CreateIndex
CREATE INDEX "data_source_relationships_toColumnId_idx" ON "non_zero"."data_source_relationships"("toColumnId");

-- CreateIndex
CREATE UNIQUE INDEX "data_source_relationships_fromColumnId_toColumnId_key" ON "non_zero"."data_source_relationships"("fromColumnId", "toColumnId");

-- CreateIndex
CREATE INDEX "dynamic_dashboards_workspaceId_idx" ON "non_zero"."dynamic_dashboards"("workspaceId");

-- CreateIndex
CREATE INDEX "dynamic_dashboards_createdBy_idx" ON "non_zero"."dynamic_dashboards"("createdBy");

-- CreateIndex
CREATE UNIQUE INDEX "dynamic_dashboards_workspaceId_name_key" ON "non_zero"."dynamic_dashboards"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "dashboard_participants_dashboardId_idx" ON "non_zero"."dashboard_participants"("dashboardId");

-- CreateIndex
CREATE INDEX "dashboard_participants_userId_idx" ON "non_zero"."dashboard_participants"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "dashboard_participants_dashboardId_userId_key" ON "non_zero"."dashboard_participants"("dashboardId", "userId");

-- CreateIndex
CREATE INDEX "dashboard_activity_entityType_entityId_createdAt_idx" ON "non_zero"."dashboard_activity"("entityType", "entityId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "dashboard_activity_createdAt_idx" ON "non_zero"."dashboard_activity"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "dashboard_activity_actorUserId_idx" ON "non_zero"."dashboard_activity"("actorUserId");

-- CreateIndex
CREATE INDEX "dynamic_dashboard_queries_queryType_idx" ON "non_zero"."dynamic_dashboard_queries"("queryType");

-- CreateIndex
CREATE INDEX "dynamic_dashboard_queries_mapping_dashboardId_idx" ON "non_zero"."dynamic_dashboard_queries_mapping"("dashboardId");

-- CreateIndex
CREATE INDEX "dynamic_dashboard_queries_mapping_queryId_idx" ON "non_zero"."dynamic_dashboard_queries_mapping"("queryId");

-- CreateIndex
CREATE INDEX "available_app_permissions_name_idx" ON "public"."available_app_permissions"("name");

-- CreateIndex
CREATE INDEX "available_app_permissions_type_idx" ON "public"."available_app_permissions"("type");

-- CreateIndex
CREATE UNIQUE INDEX "available_app_permissions_name_type_key" ON "public"."available_app_permissions"("name", "type");

-- CreateIndex
CREATE INDEX "app_permission_appId_idx" ON "public"."app_permission"("appId");

-- CreateIndex
CREATE INDEX "app_permission_permissionId_idx" ON "public"."app_permission"("permissionId");

-- CreateIndex
CREATE UNIQUE INDEX "app_permission_appId_permissionId_key" ON "public"."app_permission"("appId", "permissionId");

-- CreateIndex
CREATE INDEX "installed_app_permissions_installedAppId_idx" ON "public"."installed_app_permissions"("installedAppId");

-- CreateIndex
CREATE INDEX "installed_app_permissions_permissionId_idx" ON "public"."installed_app_permissions"("permissionId");

-- CreateIndex
CREATE UNIQUE INDEX "installed_app_permissions_installedAppId_permissionId_key" ON "public"."installed_app_permissions"("installedAppId", "permissionId");

-- CreateIndex
CREATE INDEX "tags_sourceId_sourceType_tagCategory_idx" ON "non_zero"."tags"("sourceId", "sourceType", "tagCategory");

-- CreateIndex
CREATE INDEX "tags_workspaceId_sourceType_configKey_tagCategory_tag_idx" ON "non_zero"."tags"("workspaceId", "sourceType", "configKey", "tagCategory", "tag");

-- CreateIndex
CREATE INDEX "tags_config_configKey_isDeleted_idx" ON "non_zero"."tags_config"("configKey", "isDeleted");

-- CreateIndex
CREATE INDEX "tags_config_sourceType_workspaceId_isDeleted_idx" ON "non_zero"."tags_config"("sourceType", "workspaceId", "isDeleted");

-- CreateIndex
CREATE INDEX "thread_type_vocabulary_workspaceId_scope_status_idx" ON "non_zero"."thread_type_vocabulary"("workspaceId", "scope", "status");

-- CreateIndex
CREATE UNIQUE INDEX "thread_type_vocabulary_scope_scopeId_name_key" ON "non_zero"."thread_type_vocabulary"("scope", "scopeId", "name");

-- CreateIndex
CREATE INDEX "docling_async_files_status_priority_idx" ON "non_zero"."docling_async_files"("status", "available_at", "base_priority", "created_at");

-- CreateIndex
CREATE INDEX "docling_async_files_active_status_idx" ON "non_zero"."docling_async_files"("status", "lease_until");

-- CreateIndex
CREATE INDEX "docling_async_files_collection_idx" ON "non_zero"."docling_async_files"("collection_id");

-- CreateIndex
CREATE INDEX "docling_async_parts_status_available_idx" ON "non_zero"."docling_async_parts"("status", "available_at", "created_at");

-- CreateIndex
CREATE INDEX "docling_async_parts_file_status_idx" ON "non_zero"."docling_async_parts"("file_id", "status");

-- CreateIndex
CREATE INDEX "docling_async_parts_submit_permit_idx" ON "non_zero"."docling_async_parts"("submit_permit_id");

-- CreateIndex
CREATE INDEX "docling_async_parts_file_status_part_idx" ON "non_zero"."docling_async_parts"("file_id", "status", "part_index");

-- CreateIndex
CREATE INDEX "docling_async_parts_status_file_idx" ON "non_zero"."docling_async_parts"("status", "file_id");

-- CreateIndex
CREATE UNIQUE INDEX "docling_async_parts_current_job_id_uidx" ON "non_zero"."docling_async_parts"("current_job_id");

-- CreateIndex
CREATE INDEX "entities_workspaceId_type_idx" ON "non_zero"."entities"("workspaceId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "entities_workspaceId_type_normalizedName_key" ON "non_zero"."entities"("workspaceId", "type", "normalizedName");

-- CreateIndex
CREATE INDEX "entity_aliases_entityId_idx" ON "non_zero"."entity_aliases"("entityId");

-- CreateIndex
CREATE UNIQUE INDEX "entity_aliases_workspaceId_type_normalizedForm_key" ON "non_zero"."entity_aliases"("workspaceId", "type", "normalizedForm");

-- CreateIndex
CREATE INDEX "execution_items_conversationId_status_idx" ON "non_zero"."execution_items"("conversationId", "status");

-- CreateIndex
CREATE INDEX "execution_items_channelId_status_idx" ON "non_zero"."execution_items"("channelId", "status");

-- CreateIndex
CREATE INDEX "execution_items_pendingOn_idx" ON "non_zero"."execution_items" USING GIN ("pendingOn");

-- CreateIndex
CREATE INDEX "execution_items_requestedBy_idx" ON "non_zero"."execution_items" USING GIN ("requestedBy");

-- CreateIndex
CREATE INDEX "execution_items_workspaceId_status_updatedAt_idx" ON "non_zero"."execution_items"("workspaceId", "status", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "execution_item_mutations_itemId_createdAt_idx" ON "non_zero"."execution_item_mutations"("itemId", "createdAt");

-- CreateIndex
CREATE INDEX "execution_run_logs_conversationId_createdAt_idx" ON "non_zero"."execution_run_logs"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "execution_run_logs_createdAt_idx" ON "non_zero"."execution_run_logs"("createdAt");

-- CreateIndex
CREATE INDEX "radar_rules_workspaceId_userId_idx" ON "non_zero"."radar_rules"("workspaceId", "userId");

