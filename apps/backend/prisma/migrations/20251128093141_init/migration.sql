-- CreateEnum
CREATE TYPE "WorkflowCategory" AS ENUM ('USER_ONBOARDING', 'BUG_WORKFLOW', 'BUG_WORKFLOW_EVAL', 'BUG_WORKFLOW_EVAL_INNER_STEPS', 'BUG_WORKFLOW_EVAL_INNER_STEPS_EXPERIMENTAL', 'FEATURE_IMPLEMENTATION', 'FEATURE_PLANNING', 'XYNE_SPACES_FEATURE_IMPLEMENTATION', 'FIDO_SERVER_WORKFLOW', 'CONNECTOR_MIGRATION', 'CODER_WORKFLOW', 'QUERY_WORKFLOW', 'QUERY', 'ISSUE', 'REQUIREMENT_NEW', 'REQUIREMENT_ENHANCEMENT', 'FULL_PG_INTEGRATION', 'INVESTIGATION_WORKFLOW', 'GENIUS_INVESTIGATION_WORKFLOW', 'STAGE_APPROVAL_WORKFLOW');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('NEW', 'TO_BE_PICKED_UP', 'IN_PROGRESS', 'ON_HOLD_EXTERNAL', 'ON_HOLD_INTERNAL', 'COMPLETED', 'REJECTED', 'DROPPED', 'BACKLOG', 'RESOLVED');

-- CreateEnum
CREATE TYPE "TicketPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "EntityType" AS ENUM ('MERCHANT', 'GATEWAY');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('TITLE', 'DESCRIPTION', 'STATUS', 'ASSIGNED_TO', 'PRIORITY', 'ETA', 'METADATA', 'CLOSED_AT', 'CLOSED_BY', 'REFERENCE_TICKET', 'STAGE_NAME', 'TAGS', 'ENTITY');

-- CreateEnum
CREATE TYPE "AttachmentEntityType" AS ENUM ('TICKET', 'CHAT');

-- CreateEnum
CREATE TYPE "TicketEnvironment" AS ENUM ('DEVELOPMENT', 'STAGING', 'PRODUCTION');

-- CreateEnum
CREATE TYPE "ReportedBy" AS ENUM ('MERCHANT', 'INTERNAL');

-- CreateEnum
CREATE TYPE "ChannelScopeType" AS ENUM ('DEFAULT', 'DM', 'TICKET', 'DOCUMENT', 'GROUP_DM');

-- CreateEnum
CREATE TYPE "ChannelRole" AS ENUM ('ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "ChannelVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('USER', 'BOT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "OrgRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER');

-- CreateEnum
CREATE TYPE "CallType" AS ENUM ('AUDIO', 'VIDEO');

-- CreateEnum
CREATE TYPE "CallStatus" AS ENUM ('SCHEDULED', 'ACTIVE', 'IN_PROGRESS', 'ENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ParticipantStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED');

-- CreateEnum
CREATE TYPE "CallExceptionType" AS ENUM ('CANCELLED', 'RESCHEDULED', 'MODIFIED');

-- CreateEnum
CREATE TYPE "ConversationParticipation" AS ENUM ('AUTHOR', 'MENTIONED');

-- CreateEnum
CREATE TYPE "AuthProvider" AS ENUM ('GOOGLE', 'API_KEY');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "UserPresenceStatus" AS ENUM ('ONLINE', 'AWAY', 'OFFLINE');

-- CreateEnum
CREATE TYPE "AccessType" AS ENUM ('ADMIN', 'READ', 'WRITE');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "ACLAuditEventType" AS ENUM ('RESOURCE_CREATED', 'RESOURCE_UPDATED', 'RESOURCE_DELETED', 'PERMISSION_GRANTED', 'PERMISSION_REVOKED', 'PERMISSION_UPDATED', 'USER_GROUP_CREATED', 'USER_GROUP_UPDATED', 'USER_GROUP_DELETED');

-- CreateEnum
CREATE TYPE "ACLAuditTargetType" AS ENUM ('RESOURCE', 'RESOURCE_ACCESS', 'USER_GROUP');

-- CreateEnum
CREATE TYPE "PRStatus" AS ENUM ('OPEN', 'DECLINED', 'MERGED');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INCOMING', 'OUTGOING');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('TICKET_STATUS_CHANGE', 'TICKET_ASSIGNMENT', 'TICKET_REASSIGNMENT', 'MENTION', 'DIRECT_MESSAGE', 'WORKFLOW_COMPLETION', 'WORKFLOW_FAILURE');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('UNREAD', 'READ', 'DISMISSED');

-- CreateEnum
CREATE TYPE "NotificationDeliveryMethod" AS ENUM ('BROWSER', 'EMAIL', 'SLACK');

-- CreateTable
CREATE TABLE "agents" (
    "id" TEXT NOT NULL,
    "userDefinedId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
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
CREATE TABLE "models" (
    "id" TEXT NOT NULL,
    "userDefinedId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "credentials" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tools" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Enabled',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_tools_mappings" (
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
CREATE TABLE "tickets" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'NEW',
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "assignedTo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "conversationId" TEXT NOT NULL,
    "eta" TIMESTAMP(3),
    "priority" "TicketPriority" NOT NULL DEFAULT 'LOW',
    "metadata" JSONB,
    "closedAt" TIMESTAMP(3),
    "closedBy" TEXT,
    "referenceTicket" TEXT[],
    "xyneId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userGroupId" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "stageName" TEXT NOT NULL,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sub_tickets" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
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
CREATE TABLE "ticket_sub_ticket_mappings" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "subTicketId" TEXT NOT NULL,

    CONSTRAINT "ticket_sub_ticket_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_activities" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activityType" "ActivityType" NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "ticket_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_entity_mappings" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "entityType" "EntityType" NOT NULL,
    "entityName" TEXT NOT NULL,

    CONSTRAINT "ticket_entity_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_tags" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,

    CONSTRAINT "ticket_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflows" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "context" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "workflowName" TEXT,
    "metadata" TEXT,
    "configuration" TEXT,
    "workflowType" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_executions" (
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

    CONSTRAINT "workflow_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_execution_locks" (
    "id" TEXT NOT NULL,
    "workflowExecutionId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "expiry" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_execution_locks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_steps" (
    "id" TEXT NOT NULL,
    "workflowExecutionId" TEXT NOT NULL,
    "stepExecutorType" TEXT NOT NULL,
    "stepName" TEXT,
    "type" TEXT,
    "previousStepId" TEXT,
    "data" TEXT,
    "status" TEXT,
    "markdownSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_steps" (
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
CREATE TABLE "external_step_responses" (
    "id" TEXT NOT NULL,
    "workflowExecutionId" TEXT NOT NULL,
    "workflowStepId" TEXT NOT NULL,
    "rawResponse" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_step_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
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
CREATE TABLE "user_groups" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "alias" TEXT,
    "description" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "refreshTokenExpiry" TIMESTAMP(3) NOT NULL,
    "accessToken" TEXT,
    "accessTokenExpiry" TIMESTAMP(3),
    "status" "SessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "deviceInfo" TEXT,
    "ipAddress" TEXT,
    "lastActivity" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "picture" TEXT,
    "authProvider" "AuthProvider" NOT NULL DEFAULT 'GOOGLE',
    "providerUserId" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_group_mappings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userGroupId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_group_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_presence" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "UserPresenceStatus" NOT NULL DEFAULT 'OFFLINE',
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isManual" BOOLEAN NOT NULL DEFAULT false,
    "deviceInfo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_presence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resources" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resource_access" (
    "id" TEXT NOT NULL,
    "groupId" TEXT,
    "userId" TEXT,
    "resourceId" TEXT NOT NULL,
    "accessType" "AccessType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "resource_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "acl_audit_logs" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorUserId" TEXT,
    "eventType" "ACLAuditEventType" NOT NULL,
    "targetType" "ACLAuditTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acl_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pull_requests" (
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
    "status" "PRStatus" NOT NULL,

    CONSTRAINT "pull_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("orgId")
);

-- CreateTable
CREATE TABLE "org_members" (
    "memberId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "OrgRole" NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invitedBy" TEXT,

    CONSTRAINT "org_members_pkey" PRIMARY KEY ("memberId")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "boards" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "boards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stages" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "eta" INTEGER NOT NULL,
    "boardId" TEXT NOT NULL,
    "sequenceNumber" INTEGER NOT NULL,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channels" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "scopeType" "ChannelScopeType" NOT NULL,
    "visibility" "ChannelVisibility" NOT NULL DEFAULT 'PUBLIC',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,
    "metadata" JSONB,
    "projectId" TEXT NOT NULL,

    CONSTRAINT "channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_participants" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "role" "ChannelRole" NOT NULL DEFAULT 'MEMBER',
    "lastViewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastViewedConversationId" TEXT,
    "isStarred" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "channel_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "conversationId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "initialMessageId" TEXT NOT NULL,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "replyCount" INTEGER NOT NULL DEFAULT 0,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("conversationId")
);

-- CreateTable
CREATE TABLE "conversation_participants" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "participationType" "ConversationParticipation" NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "messageId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "msgType" "MessageType" NOT NULL DEFAULT 'USER',
    "hasAttachment" BOOLEAN NOT NULL DEFAULT false,
    "edited" BOOLEAN NOT NULL DEFAULT false,
    "showInChannel" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("messageId")
);

-- CreateTable
CREATE TABLE "message_attachments" (
    "id" TEXT NOT NULL,
    "entityType" "AttachmentEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "storageProvider" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "mimetype" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "uploadedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "url" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "metadata" JSONB,
    "conversationId" TEXT NOT NULL,
    "thumbnailUrl" TEXT,

    CONSTRAINT "message_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reactions" (
    "reactionId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emojiName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reactions_pkey" PRIMARY KEY ("reactionId")
);

-- CreateTable
CREATE TABLE "reaction_counts" (
    "countId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "emojiName" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reaction_counts_pkey" PRIMARY KEY ("countId")
);

-- CreateTable
CREATE TABLE "activities" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "actorAction" TEXT NOT NULL,
    "actionSource" TEXT NOT NULL,
    "actionSourceId" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_sources" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "credentials" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_messages" (
    "id" TEXT NOT NULL,
    "externalSourceId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "externalThreadId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'UNREAD',
    "deliveryMethods" "NotificationDeliveryMethod"[],
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
CREATE TABLE "notification_preferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "notificationType" "NotificationType" NOT NULL,
    "browserEnabled" BOOLEAN NOT NULL DEFAULT true,
    "emailEnabled" BOOLEAN NOT NULL DEFAULT false,
    "slackEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "browser_notification_subscriptions" (
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
CREATE TABLE "calls" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "title" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "organizerId" TEXT,
    "channelId" TEXT NOT NULL,
    "orgName" TEXT,
    "description" TEXT,
    "callType" "CallType" NOT NULL DEFAULT 'VIDEO',
    "status" "CallStatus" NOT NULL DEFAULT 'ACTIVE',
    "roomLink" TEXT,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "isRecurring" BOOLEAN NOT NULL DEFAULT false,
    "recurringSeriesId" TEXT,
    "recurrenceRule" TEXT,
    "instanceDate" TIMESTAMP(3),
    "recordingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "transcript" TEXT,
    "aiSummary" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,

    CONSTRAINT "calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_participants" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "ParticipantStatus" NOT NULL DEFAULT 'PENDING',
    "joinedAt" TIMESTAMP(3),
    "leftAt" TIMESTAMP(3),
    "metadata" JSONB,

    CONSTRAINT "call_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_invited_users" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "invitedBy" TEXT NOT NULL,
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "response" TEXT,
    "metadata" JSONB,

    CONSTRAINT "call_invited_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_exceptions" (
    "id" TEXT NOT NULL,
    "recurringSeriesId" TEXT NOT NULL,
    "originalDate" TIMESTAMP(3) NOT NULL,
    "action" "CallExceptionType" NOT NULL,
    "newStartsAt" TIMESTAMP(3),
    "newEndsAt" TIMESTAMP(3),
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "call_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agents_userDefinedId_key" ON "agents"("userDefinedId");

-- CreateIndex
CREATE UNIQUE INDEX "agents_name_version_key" ON "agents"("name", "version");

-- CreateIndex
CREATE UNIQUE INDEX "models_userDefinedId_key" ON "models"("userDefinedId");

-- CreateIndex
CREATE UNIQUE INDEX "tools_name_key" ON "tools"("name");

-- CreateIndex
CREATE UNIQUE INDEX "agent_tools_mappings_agentId_toolId_key" ON "agent_tools_mappings"("agentId", "toolId");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_xyneId_key" ON "tickets"("xyneId");

-- CreateIndex
CREATE INDEX "tickets_status_idx" ON "tickets"("status");

-- CreateIndex
CREATE INDEX "tickets_assignedTo_status_idx" ON "tickets"("assignedTo", "status");

-- CreateIndex
CREATE INDEX "tickets_createdAt_idx" ON "tickets"("createdAt");

-- CreateIndex
CREATE INDEX "tickets_updatedAt_idx" ON "tickets"("updatedAt");

-- CreateIndex
CREATE INDEX "tickets_eta_idx" ON "tickets"("eta");

-- CreateIndex
CREATE INDEX "tickets_boardId_idx" ON "tickets"("boardId");

-- CreateIndex
CREATE INDEX "tickets_projectId_idx" ON "tickets"("projectId");

-- CreateIndex
CREATE INDEX "tickets_userGroupId_idx" ON "tickets"("userGroupId");

-- CreateIndex
CREATE INDEX "sub_tickets_title_idx" ON "sub_tickets"("title");

-- CreateIndex
CREATE INDEX "sub_tickets_mappedTicketId_idx" ON "sub_tickets"("mappedTicketId");

-- CreateIndex
CREATE INDEX "ticket_sub_ticket_mappings_ticketId_idx" ON "ticket_sub_ticket_mappings"("ticketId");

-- CreateIndex
CREATE INDEX "ticket_sub_ticket_mappings_subTicketId_idx" ON "ticket_sub_ticket_mappings"("subTicketId");

-- CreateIndex
CREATE INDEX "ticket_activities_ticketId_idx" ON "ticket_activities"("ticketId");

-- CreateIndex
CREATE INDEX "ticket_entity_mappings_ticketId_idx" ON "ticket_entity_mappings"("ticketId");

-- CreateIndex
CREATE INDEX "ticket_tags_ticketId_idx" ON "ticket_tags"("ticketId");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_execution_locks_workflowExecutionId_key" ON "workflow_execution_locks"("workflowExecutionId");

-- CreateIndex
CREATE UNIQUE INDEX "external_step_responses_workflowStepId_key" ON "external_step_responses"("workflowStepId");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_keyHash_key" ON "api_keys"("keyHash");

-- CreateIndex
CREATE UNIQUE INDEX "user_groups_name_key" ON "user_groups"("name");

-- CreateIndex
CREATE UNIQUE INDEX "user_groups_alias_key" ON "user_groups"("alias");

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_refreshToken_key" ON "user_sessions"("refreshToken");

-- CreateIndex
CREATE INDEX "user_sessions_userId_idx" ON "user_sessions"("userId");

-- CreateIndex
CREATE INDEX "user_sessions_refreshToken_idx" ON "user_sessions"("refreshToken");

-- CreateIndex
CREATE INDEX "user_sessions_status_idx" ON "user_sessions"("status");

-- CreateIndex
CREATE INDEX "user_sessions_refreshTokenExpiry_idx" ON "user_sessions"("refreshTokenExpiry");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_providerUserId_key" ON "users"("providerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "user_group_mappings_userId_userGroupId_key" ON "user_group_mappings"("userId", "userGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "user_presence_userId_key" ON "user_presence"("userId");

-- CreateIndex
CREATE INDEX "user_presence_status_idx" ON "user_presence"("status");

-- CreateIndex
CREATE INDEX "user_presence_lastActiveAt_idx" ON "user_presence"("lastActiveAt");

-- CreateIndex
CREATE UNIQUE INDEX "resources_name_key" ON "resources"("name");

-- CreateIndex
CREATE UNIQUE INDEX "resource_access_groupId_resourceId_accessType_key" ON "resource_access"("groupId", "resourceId", "accessType");

-- CreateIndex
CREATE UNIQUE INDEX "resource_access_userId_resourceId_accessType_key" ON "resource_access"("userId", "resourceId", "accessType");

-- CreateIndex
CREATE INDEX "acl_audit_logs_timestamp_idx" ON "acl_audit_logs"("timestamp");

-- CreateIndex
CREATE INDEX "acl_audit_logs_eventType_idx" ON "acl_audit_logs"("eventType");

-- CreateIndex
CREATE INDEX "acl_audit_logs_targetType_targetId_idx" ON "acl_audit_logs"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "acl_audit_logs_actorUserId_idx" ON "acl_audit_logs"("actorUserId");

-- CreateIndex
CREATE INDEX "pull_requests_date_idx" ON "pull_requests"("date");

-- CreateIndex
CREATE UNIQUE INDEX "pull_requests_prId_prUrl_key" ON "pull_requests"("prId", "prUrl");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_name_key" ON "organizations"("name");

-- CreateIndex
CREATE INDEX "org_members_orgId_idx" ON "org_members"("orgId");

-- CreateIndex
CREATE INDEX "org_members_userId_idx" ON "org_members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "org_members_orgId_userId_key" ON "org_members"("orgId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "projects_name_key" ON "projects"("name");

-- CreateIndex
CREATE UNIQUE INDEX "boards_name_key" ON "boards"("name");

-- CreateIndex
CREATE INDEX "boards_projectId_idx" ON "boards"("projectId");

-- CreateIndex
CREATE INDEX "stages_boardId_idx" ON "stages"("boardId");

-- CreateIndex
CREATE INDEX "channel_participants_channelId_idx" ON "channel_participants"("channelId");

-- CreateIndex
CREATE INDEX "channel_participants_userId_idx" ON "channel_participants"("userId");

-- CreateIndex
CREATE INDEX "channel_participants_userId_isStarred_idx" ON "channel_participants"("userId", "isStarred");

-- CreateIndex
CREATE UNIQUE INDEX "channel_participants_channelId_userId_key" ON "channel_participants"("channelId", "userId");

-- CreateIndex
CREATE INDEX "conversations_channelId_lastActivityAt_idx" ON "conversations"("channelId", "lastActivityAt");

-- CreateIndex
CREATE INDEX "conversations_channelId_idx" ON "conversations"("channelId");

-- CreateIndex
CREATE INDEX "conversation_participants_conversationId_idx" ON "conversation_participants"("conversationId");

-- CreateIndex
CREATE INDEX "conversation_participants_userId_idx" ON "conversation_participants"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_participants_conversationId_userId_key" ON "conversation_participants"("conversationId", "userId");

-- CreateIndex
CREATE INDEX "messages_conversationId_createdAt_idx" ON "messages"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "messages_conversationId_idx" ON "messages"("conversationId");

-- CreateIndex
CREATE INDEX "message_attachments_entityType_idx" ON "message_attachments"("entityType");

-- CreateIndex
CREATE INDEX "message_attachments_conversationId_idx" ON "message_attachments"("conversationId");

-- CreateIndex
CREATE INDEX "message_attachments_entityId_idx" ON "message_attachments"("entityId");

-- CreateIndex
CREATE INDEX "reactions_messageId_idx" ON "reactions"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "reactions_messageId_userId_emojiName_key" ON "reactions"("messageId", "userId", "emojiName");

-- CreateIndex
CREATE INDEX "reaction_counts_messageId_idx" ON "reaction_counts"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "reaction_counts_messageId_emojiName_key" ON "reaction_counts"("messageId", "emojiName");

-- CreateIndex
CREATE INDEX "activities_userId_createdAt_idx" ON "activities"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "activities_actionSource_actionSourceId_idx" ON "activities"("actionSource", "actionSourceId");

-- CreateIndex
CREATE UNIQUE INDEX "external_sources_name_key" ON "external_sources"("name");

-- CreateIndex
CREATE INDEX "external_messages_externalSourceId_externalThreadId_idx" ON "external_messages"("externalSourceId", "externalThreadId");

-- CreateIndex
CREATE INDEX "external_messages_messageId_idx" ON "external_messages"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "external_messages_externalSourceId_externalId_key" ON "external_messages"("externalSourceId", "externalId");

-- CreateIndex
CREATE INDEX "notifications_userId_status_idx" ON "notifications"("userId", "status");

-- CreateIndex
CREATE INDEX "notifications_type_idx" ON "notifications"("type");

-- CreateIndex
CREATE INDEX "notifications_relatedEntityType_relatedEntityId_idx" ON "notifications"("relatedEntityType", "relatedEntityId");

-- CreateIndex
CREATE INDEX "notifications_createdAt_idx" ON "notifications"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_userId_notificationType_key" ON "notification_preferences"("userId", "notificationType");

-- CreateIndex
CREATE UNIQUE INDEX "browser_notification_subscriptions_endpoint_key" ON "browser_notification_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "browser_notification_subscriptions_userId_idx" ON "browser_notification_subscriptions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "calls_externalId_key" ON "calls"("externalId");

-- CreateIndex
CREATE INDEX "calls_externalId_idx" ON "calls"("externalId");

-- CreateIndex
CREATE INDEX "calls_createdByUserId_idx" ON "calls"("createdByUserId");

-- CreateIndex
CREATE INDEX "calls_organizerId_idx" ON "calls"("organizerId");

-- CreateIndex
CREATE INDEX "calls_channelId_idx" ON "calls"("channelId");

-- CreateIndex
CREATE INDEX "calls_status_lastActivityAt_idx" ON "calls"("status", "lastActivityAt");

-- CreateIndex
CREATE INDEX "calls_startsAt_idx" ON "calls"("startsAt");

-- CreateIndex
CREATE INDEX "calls_recurringSeriesId_idx" ON "calls"("recurringSeriesId");

-- CreateIndex
CREATE INDEX "calls_isRecurring_idx" ON "calls"("isRecurring");

-- CreateIndex
CREATE INDEX "calls_instanceDate_idx" ON "calls"("instanceDate");

-- CreateIndex
CREATE INDEX "calls_orgName_idx" ON "calls"("orgName");

-- CreateIndex
CREATE INDEX "call_participants_callId_idx" ON "call_participants"("callId");

-- CreateIndex
CREATE INDEX "call_participants_userId_idx" ON "call_participants"("userId");

-- CreateIndex
CREATE INDEX "call_participants_callId_leftAt_idx" ON "call_participants"("callId", "leftAt");

-- CreateIndex
CREATE INDEX "call_participants_status_idx" ON "call_participants"("status");

-- CreateIndex
CREATE UNIQUE INDEX "call_participants_callId_userId_key" ON "call_participants"("callId", "userId");

-- CreateIndex
CREATE INDEX "call_invited_users_callId_idx" ON "call_invited_users"("callId");

-- CreateIndex
CREATE INDEX "call_invited_users_userId_idx" ON "call_invited_users"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "call_invited_users_callId_userId_key" ON "call_invited_users"("callId", "userId");

-- CreateIndex
CREATE INDEX "call_exceptions_recurringSeriesId_idx" ON "call_exceptions"("recurringSeriesId");

-- CreateIndex
CREATE INDEX "call_exceptions_originalDate_idx" ON "call_exceptions"("originalDate");

-- CreateIndex
CREATE UNIQUE INDEX "call_exceptions_recurringSeriesId_originalDate_key" ON "call_exceptions"("recurringSeriesId", "originalDate");

-- AddForeignKey
ALTER TABLE "agents" ADD CONSTRAINT "agents_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_tools_mappings" ADD CONSTRAINT "agent_tools_mappings_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_tools_mappings" ADD CONSTRAINT "agent_tools_mappings_toolId_fkey" FOREIGN KEY ("toolId") REFERENCES "tools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_parentWorkflowExecutionId_fkey" FOREIGN KEY ("parentWorkflowExecutionId") REFERENCES "workflow_executions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_execution_locks" ADD CONSTRAINT "workflow_execution_locks_workflowExecutionId_fkey" FOREIGN KEY ("workflowExecutionId") REFERENCES "workflow_executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_steps" ADD CONSTRAINT "workflow_steps_workflowExecutionId_fkey" FOREIGN KEY ("workflowExecutionId") REFERENCES "workflow_executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_steps" ADD CONSTRAINT "agent_steps_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_step_responses" ADD CONSTRAINT "external_step_responses_workflowExecutionId_fkey" FOREIGN KEY ("workflowExecutionId") REFERENCES "workflow_executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_step_responses" ADD CONSTRAINT "external_step_responses_workflowStepId_fkey" FOREIGN KEY ("workflowStepId") REFERENCES "workflow_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_presence" ADD CONSTRAINT "user_presence_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_access" ADD CONSTRAINT "resource_access_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "user_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_access" ADD CONSTRAINT "resource_access_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_access" ADD CONSTRAINT "resource_access_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acl_audit_logs" ADD CONSTRAINT "acl_audit_logs_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
