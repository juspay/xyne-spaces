-- Create tables in the workflow schema for backward compatibility.
-- Existing public schema tables are left in place; new data flows into workflow schema.

CREATE TABLE "workflow"."agent_steps" (
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
CREATE INDEX "agent_steps_agentId_idx" ON "workflow"."agent_steps"("agentId");

CREATE TABLE "workflow"."external_step_responses" (
    "id" TEXT NOT NULL,
    "workflowExecutionId" TEXT NOT NULL,
    "workflowStepId" TEXT NOT NULL,
    "rawResponse" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "external_step_responses_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "external_step_responses_workflowStepId_key" ON "workflow"."external_step_responses"("workflowStepId");
CREATE INDEX "external_step_responses_workflowExecutionId_idx" ON "workflow"."external_step_responses"("workflowExecutionId");

CREATE TABLE "workflow"."api_keys" (
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
CREATE UNIQUE INDEX "api_keys_keyHash_key" ON "workflow"."api_keys"("keyHash");
CREATE INDEX "api_keys_userId_idx" ON "workflow"."api_keys"("userId");

CREATE TABLE "workflow"."user_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "refreshTokenExpiry" TIMESTAMP(3) NOT NULL,
    "accessToken" TEXT,
    "accessTokenExpiry" TIMESTAMP(3),
    "status" "SessionStatus" NOT NULL DEFAULT 'ACTIVE'::"SessionStatus",
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
CREATE UNIQUE INDEX "user_sessions_refreshToken_key" ON "workflow"."user_sessions"("refreshToken");
CREATE INDEX "user_sessions_refreshToken_idx" ON "workflow"."user_sessions"("refreshToken");
CREATE INDEX "user_sessions_userId_idx" ON "workflow"."user_sessions"("userId");
CREATE INDEX "user_sessions_status_idx" ON "workflow"."user_sessions"("status");
CREATE INDEX "user_sessions_refreshTokenExpiry_idx" ON "workflow"."user_sessions"("refreshTokenExpiry");

CREATE TABLE "workflow"."acl_audit_logs" (
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
CREATE INDEX "acl_audit_logs_timestamp_idx" ON "workflow"."acl_audit_logs"("timestamp");
CREATE INDEX "acl_audit_logs_eventType_idx" ON "workflow"."acl_audit_logs"("eventType");
CREATE INDEX "acl_audit_logs_targetType_targetId_idx" ON "workflow"."acl_audit_logs"("targetType", "targetId");
CREATE INDEX "acl_audit_logs_actorUserId_idx" ON "workflow"."acl_audit_logs"("actorUserId");

CREATE TABLE "workflow"."message_search" (
    "messageId" TEXT NOT NULL,
    "plaintextContent" TEXT NOT NULL,
    "searchVector" tsvector NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "message_search_pkey" PRIMARY KEY ("messageId")
);
CREATE INDEX "message_search_plaintext_trgm_idx" ON "workflow"."message_search" USING gin ("plaintextContent" gin_trgm_ops);
CREATE INDEX "message_search_vector_idx" ON "workflow"."message_search" USING gin ("searchVector");

CREATE TABLE "workflow"."external_sources" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "boardId" TEXT,
    "credentials" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "external_sources_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "external_sources_name_key" ON "workflow"."external_sources"("name");
CREATE INDEX "external_sources_boardId_idx" ON "workflow"."external_sources"("boardId");

CREATE TABLE "workflow"."external_messages" (
    "id" TEXT NOT NULL,
    "externalSourceId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "externalThreadId" TEXT NOT NULL,
    "entityType" "ExternalEntityType" NOT NULL DEFAULT 'MESSAGE'::"ExternalEntityType",
    "entityId" TEXT,
    "messageId" TEXT NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "external_messages_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "external_messages_externalSourceId_externalId_key" ON "workflow"."external_messages"("externalSourceId", "externalId");
CREATE INDEX "external_messages_externalSourceId_externalThreadId_idx" ON "workflow"."external_messages"("externalSourceId", "externalThreadId");
CREATE INDEX "external_messages_messageId_idx" ON "workflow"."external_messages"("messageId");

CREATE TABLE "workflow"."notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'UNREAD'::"NotificationStatus",
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
CREATE INDEX "notifications_userId_status_idx" ON "workflow"."notifications"("userId", "status");
CREATE INDEX "notifications_type_idx" ON "workflow"."notifications"("type");
CREATE INDEX "notifications_relatedEntityType_relatedEntityId_idx" ON "workflow"."notifications"("relatedEntityType", "relatedEntityId");
CREATE INDEX "notifications_createdAt_idx" ON "workflow"."notifications"("createdAt");

CREATE TABLE "workflow"."browser_notification_subscriptions" (
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
CREATE UNIQUE INDEX "browser_notification_subscriptions_endpoint_key" ON "workflow"."browser_notification_subscriptions"("endpoint");
CREATE INDEX "browser_notification_subscriptions_userId_idx" ON "workflow"."browser_notification_subscriptions"("userId");

CREATE TABLE "workflow"."vespa_insertion_logs" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "type" "VespaOperationType" NOT NULL,
    "status" "VespaInsertionStatus" NOT NULL DEFAULT 'PENDING'::"VespaInsertionStatus",
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
CREATE INDEX "vespa_insertion_logs_entityId_idx" ON "workflow"."vespa_insertion_logs"("entityId");
CREATE INDEX "vespa_insertion_logs_entityType_idx" ON "workflow"."vespa_insertion_logs"("entityType");
CREATE INDEX "vespa_insertion_logs_userId_idx" ON "workflow"."vespa_insertion_logs"("userId");
CREATE INDEX "vespa_insertion_logs_status_idx" ON "workflow"."vespa_insertion_logs"("status");
CREATE INDEX "vespa_insertion_logs_type_idx" ON "workflow"."vespa_insertion_logs"("type");
CREATE INDEX "vespa_insertion_logs_entityId_entityType_idx" ON "workflow"."vespa_insertion_logs"("entityId", "entityType");

CREATE TABLE "workflow"."workflow_execution_users" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workflowExecutionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "workflow_execution_users_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "workflow_execution_users_userId_workflowExecutionId_key" ON "workflow"."workflow_execution_users"("userId", "workflowExecutionId");
CREATE INDEX "workflow_execution_users_userId_idx" ON "workflow"."workflow_execution_users"("userId");
CREATE INDEX "workflow_execution_users_workflowExecutionId_idx" ON "workflow"."workflow_execution_users"("workflowExecutionId");

CREATE TABLE "workflow"."workflow_knowledge" (
    "id" TEXT NOT NULL,
    "workflowExecutionId" TEXT NOT NULL,
    "checkpointId" TEXT NOT NULL,
    "learningType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "codeContext" TEXT,
    "filePaths" TEXT[] DEFAULT ARRAY[]::text[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "workflow_knowledge_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "workflow_knowledge_workflowExecutionId_idx" ON "workflow"."workflow_knowledge"("workflowExecutionId");
CREATE INDEX "workflow_knowledge_checkpointId_idx" ON "workflow"."workflow_knowledge"("checkpointId");
