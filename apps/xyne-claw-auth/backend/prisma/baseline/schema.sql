-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "OrgRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "OrgStatus" AS ENUM ('ACTIVE', 'ARCHIVED', 'DELETED');

-- CreateEnum
CREATE TYPE "SurfaceIdentityMode" AS ENUM ('USER_ID', 'ACCESS_TOKEN');

-- CreateEnum
CREATE TYPE "SurfaceStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "AgentAuditEvent" AS ENUM ('AGENT_PROMOTED', 'AGENT_DEMOTED', 'AGENT_SHARED', 'AGENT_UNSHARED', 'AGENT_OWNERSHIP_TRANSFERRED', 'ROLE_GRANTED', 'ROLE_REVOKED', 'AGENT_CREATED', 'AGENT_DELETED', 'REQUEST_CREATED', 'REQUEST_APPROVED', 'REQUEST_REJECTED', 'MCP_GLOBAL_FALLBACK_ENABLED', 'MCP_GLOBAL_FALLBACK_DISABLED', 'MCP_GLOBAL_CREDENTIALS_SET', 'MCP_GLOBAL_CREDENTIALS_REMOVED', 'MCP_CONNECTOR_CREATED', 'MCP_CONNECTOR_UPDATED', 'MCP_CONNECTOR_DELETED', 'MCP_CONNECTOR_EDIT_REQUESTED', 'MCP_CONNECTOR_EDIT_APPROVED', 'MCP_CONNECTOR_EDIT_REJECTED', 'MCP_CONNECTOR_EDIT_SUPERSEDED', 'MCP_CONNECTOR_EDIT_CANCELLED', 'AGENT_CONFIG_UPDATED', 'AGENT_UPDATED', 'PROVIDER_CREDENTIAL_PROMOTED', 'PROVIDER_CREDENTIAL_BOUND', 'PROVIDER_CREDENTIAL_UNBOUND', 'PROVIDER_CREDENTIAL_ADOPTED', 'PROVIDER_CREDENTIAL_DELETED', 'SUBAGENT_CREATED', 'SUBAGENT_UPDATED', 'MCP_SERVER_CREATED', 'SUBAGENT_MCP_UPDATED', 'SUBAGENT_MCP_DELETED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "digitalTwinEnabled" BOOLEAN NOT NULL DEFAULT false,
    "digitalTwinEnabledAt" TIMESTAMP(3),
    "digitalTwinResponseSuffix" TEXT,
    "digitalTwinMemoryApprovalMode" TEXT NOT NULL DEFAULT 'manual',
    "digitalTwinMemoryAutoApproveMinScore" DOUBLE PRECISION NOT NULL DEFAULT 0.9,
    "digitalTwinRespondPolicy" TEXT NOT NULL DEFAULT 'learned',
    "digitalTwinBackfillState" JSONB,
    "localHarnessDefaultProvider" TEXT,
    "dailyBriefEnabled" BOOLEAN NOT NULL DEFAULT false,
    "dailyBriefEnabledAt" TIMESTAMP(3),
    "orgId" TEXT NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_memory_files" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "agentSlug" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "loadInPrompt" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_memory_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "twin_behavior_signals" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL DEFAULT 'mention',
    "outcome" TEXT NOT NULL,
    "channelId" TEXT,
    "channelName" TEXT,
    "channelType" TEXT,
    "actorId" TEXT,
    "latencyMs" INTEGER,
    "sourceMessageId" TEXT,
    "triggerPreview" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "gateDecision" TEXT,
    "gateConfidence" DOUBLE PRECISION,
    "gateReason" TEXT,
    "gateAt" TIMESTAMP(3),
    "shouldHaveResponded" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "twin_behavior_signals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "twin_response_feedback" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "channelId" TEXT,
    "channelName" TEXT,
    "sourceMessageId" TEXT,
    "incomingTask" TEXT,
    "deliveryAction" TEXT NOT NULL DEFAULT 'reply',
    "deliveryEmoji" TEXT,
    "destinationKind" TEXT,
    "draftMessage" TEXT,
    "finalMessage" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "proposedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "learnedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "twin_response_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdBy" TEXT NOT NULL,
    "status" "OrgStatus" NOT NULL DEFAULT 'ACTIVE',
    "metadata" JSONB,
    "dailyBriefAgentSlug" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "surfaces" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "identityMode" "SurfaceIdentityMode" NOT NULL,
    "supportsUserResolution" BOOLEAN NOT NULL DEFAULT false,
    "capabilities" JSONB,
    "status" "SurfaceStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "surfaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connected_surfaces" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "surfaceId" TEXT NOT NULL,
    "surfaceTenantId" TEXT NOT NULL DEFAULT '',
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "config" JSONB,
    "status" "SurfaceStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connected_surfaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_auth_state" (
    "id" TEXT NOT NULL,
    "connectedSurfaceId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "keyId" TEXT NOT NULL DEFAULT '',
    "encryptedValue" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_auth_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_surface_identities" (
    "id" TEXT NOT NULL,
    "surfaceId" TEXT NOT NULL,
    "surfaceWorkspaceId" TEXT NOT NULL DEFAULT '',
    "surfaceUserId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT,
    "status" "SurfaceStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastSeenAt" TIMESTAMP(3),
    "linkedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_surface_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "surface_agents" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "surfaceId" TEXT NOT NULL,
    "surfaceTenantId" TEXT NOT NULL DEFAULT '',
    "surfaceChannelId" TEXT,
    "externalAppId" TEXT,
    "clientId" TEXT,
    "encryptedClientSecret" TEXT,
    "signingSecret" TEXT,
    "commandName" TEXT,
    "commandConnectedSurfaceId" TEXT,
    "status" TEXT,
    "manifestHash" TEXT,
    "manifestSyncedAt" TIMESTAMP(3),
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "surface_agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "surface_agent_installs" (
    "id" TEXT NOT NULL,
    "surfaceAgentId" TEXT NOT NULL,
    "surfaceTenantId" TEXT NOT NULL,
    "encryptedBotToken" TEXT NOT NULL,
    "tenantName" TEXT,
    "botUserId" TEXT,
    "installedByUserId" TEXT,
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "surface_agent_installs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "surface_access_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "surfaceId" TEXT NOT NULL,
    "client" TEXT,
    "name" TEXT,
    "tokenHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "surface_access_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "surface_tenant_links" (
    "id" TEXT NOT NULL,
    "surfaceType" TEXT NOT NULL DEFAULT 'spaces',
    "surfaceTenantId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "surface_tenant_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_members" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "OrgRole" NOT NULL DEFAULT 'MEMBER',
    "invitedBy" TEXT,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "org_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_memory_candidates" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subsystem" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "editedText" TEXT,
    "sourceRefs" JSONB NOT NULL,
    "signalScore" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "hindsightMemoryId" TEXT,
    "source" TEXT NOT NULL,
    "pipelineEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),

    CONSTRAINT "user_memory_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "digital_twin_pipeline_events" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "runType" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceKind" TEXT,
    "windowFrom" TIMESTAMP(3) NOT NULL,
    "windowTo" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "recordCount" INTEGER NOT NULL DEFAULT 0,
    "records" JSONB,
    "existingMemoryCount" INTEGER NOT NULL DEFAULT 0,
    "emittedCount" INTEGER NOT NULL DEFAULT 0,
    "keptCount" INTEGER NOT NULL DEFAULT 0,
    "candidatesCreated" INTEGER NOT NULL DEFAULT 0,
    "autoApproved" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "trace" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "digital_twin_pipeline_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "grantedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_agent_configs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "agentSlug" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'spaces',
    "chainConfig" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "orgId" TEXT NOT NULL,

    CONSTRAINT "user_agent_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_agent_instructions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "agentSlug" TEXT NOT NULL,
    "instructions" TEXT NOT NULL DEFAULT '',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "orgId" TEXT NOT NULL,

    CONSTRAINT "user_agent_instructions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generated_content" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "agentSlug" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'DAILY_BRIEF',
    "dateBucket" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "data" JSONB,
    "status" TEXT NOT NULL DEFAULT 'generating',
    "sessionId" TEXT,
    "generatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "orgId" TEXT NOT NULL,

    CONSTRAINT "generated_content_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_brief_activity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "dateBucket" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "rejectionCount" INTEGER NOT NULL DEFAULT 0,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_brief_activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_chain_workflows" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "definition" JSONB NOT NULL,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "global" BOOLEAN NOT NULL DEFAULT false,
    "triggers" JSONB NOT NULL DEFAULT '[]',
    "credentialUserId" TEXT,
    "agentTriggerSlug" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_chain_workflows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_global_requests" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_global_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_agent_chain_bindings" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "entryAgentSlug" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_agent_chain_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_provider_credentials" (
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "encryptedKey" TEXT,
    "iv" TEXT,
    "authTag" TEXT,
    "model" TEXT,
    "baseUrl" TEXT,
    "authType" TEXT,
    "reasoningEffort" TEXT,
    "sharedCredentialId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_provider_credentials_pkey" PRIMARY KEY ("userId","provider")
);

-- CreateTable
CREATE TABLE "local_harness_devices" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "deviceName" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "installations" JSONB NOT NULL DEFAULT '[]',
    "lastSeenAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "focusedAt" TIMESTAMP(3),
    "appRoute" TEXT,

    CONSTRAINT "local_harness_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "artifact_comments" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "anchor" JSONB,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "byAgent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "artifact_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "surface_calls" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "sessionId" TEXT,
    "toolName" TEXT NOT NULL,
    "args" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "ok" BOOLEAN,
    "content" TEXT,
    "image" JSONB,
    "claimedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "surface_calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "local_harness_runs" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "agentSlug" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "deviceId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "envelope" JSONB NOT NULL,
    "progressUrl" TEXT NOT NULL,
    "callbackUrl" TEXT NOT NULL,
    "error" TEXT,
    "cliSessionId" TEXT,
    "pendingAction" JSONB,
    "pendingActionId" TEXT,
    "claimedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "local_harness_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "local_harness_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "cliSessionId" TEXT NOT NULL,
    "storagePath" TEXT,
    "sizeBytes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "local_harness_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_subagent_configs" (
    "userId" TEXT NOT NULL,
    "subagentName" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_subagent_configs_pkey" PRIMARY KEY ("userId","subagentName")
);

-- CreateTable
CREATE TABLE "agent_provider_credentials" (
    "agentId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "encryptedKey" TEXT,
    "iv" TEXT,
    "authTag" TEXT,
    "model" TEXT,
    "baseUrl" TEXT,
    "authType" TEXT,
    "reasoningEffort" TEXT,
    "createdByUserId" TEXT,
    "sharedCredentialId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_provider_credentials_pkey" PRIMARY KEY ("agentId","provider")
);

-- CreateTable
CREATE TABLE "shared_provider_credentials" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "provider" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "encryptedKey" TEXT,
    "iv" TEXT,
    "authTag" TEXT,
    "model" TEXT,
    "baseUrl" TEXT,
    "authType" TEXT,
    "reasoningEffort" TEXT,
    "ownerUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shared_provider_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agents" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "systemPrompt" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'global',
    "delegationTier" TEXT NOT NULL DEFAULT 'standard',
    "ownerUserId" TEXT,
    "orgId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "color" TEXT NOT NULL DEFAULT '#6366f1',
    "modelId" TEXT NOT NULL DEFAULT '',
    "config" JSONB NOT NULL DEFAULT '{}',
    "spacesAppId" TEXT,
    "spacesAppUserId" TEXT,
    "spacesAppToken" TEXT,
    "signingSecret" TEXT,
    "activePromptVersionId" TEXT,
    "activePromptVersion" INTEGER,
    "kbScope" TEXT NOT NULL DEFAULT 'COLLECTIONS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "promotedBy" TEXT,
    "promotedAt" TIMESTAMP(3),

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_delegation_grants" (
    "id" TEXT NOT NULL,
    "callerAgentId" TEXT NOT NULL,
    "calleeAgentId" TEXT NOT NULL,
    "identityMode" TEXT NOT NULL DEFAULT 'user',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "requestReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_delegation_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_prompt_versions" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "systemPrompt" TEXT NOT NULL,
    "note" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_prompt_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_shares" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'VIEWER',
    "sharedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_shares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_runs" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "agentSlug" TEXT NOT NULL,
    "provider" TEXT,
    "model" TEXT,
    "triggerSource" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "currentToolLabel" TEXT,
    "task" TEXT NOT NULL,
    "conversationId" TEXT,
    "scheduledJobId" TEXT,
    "channelId" TEXT,
    "projectId" TEXT,
    "projectName" TEXT,
    "result" TEXT,
    "error" TEXT,
    "reasoning" TEXT,
    "toolsUsed" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "toolInvocations" JSONB,
    "metadata" JSONB,
    "tokensIn" INTEGER,
    "tokensOut" INTEGER,
    "tokensCacheRead" INTEGER,
    "tokensCacheWrite" INTEGER,
    "totalMs" INTEGER,
    "llmTotalMs" INTEGER,
    "llmDecodeMs" INTEGER,
    "llmWaitMs" INTEGER,
    "llmTurns" INTEGER,
    "llmRetries" INTEGER,
    "ttftMs" INTEGER,
    "tokensPerSec" INTEGER,
    "toolMs" INTEGER,
    "lastRetryReason" TEXT,
    "rating" TEXT,
    "ratingComment" TEXT,
    "ratedAt" TIMESTAMP(3),
    "promptVersion" INTEGER,
    "usedUserToken" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "chatMessageId" TEXT,
    "orgId" TEXT NOT NULL,
    "parentSessionId" TEXT,
    "parentAgentSlug" TEXT,
    "parentToolCallId" TEXT,

    CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_widget_bindings" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "screenId" TEXT NOT NULL,
    "externalKey" TEXT,
    "conversationId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT,
    "spacesAppId" TEXT NOT NULL,
    "spacesAppUserId" TEXT NOT NULL,
    "agentSlug" TEXT,
    "status" TEXT,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_widget_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "agentSlug" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "reasoning" TEXT,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "parentId" TEXT,
    "attachedContext" JSONB,
    "pendingActions" JSONB,
    "runProvider" TEXT,
    "orgId" TEXT NOT NULL,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_attachments" (
    "id" TEXT NOT NULL,
    "chatMessageId" TEXT,
    "uploaderUserId" TEXT NOT NULL,
    "storageProvider" TEXT NOT NULL DEFAULT 'gcs',
    "url" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "originalFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "artifact_apps" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "conversationId" TEXT,
    "headVersionId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'PRIVATE',
    "publishedVersionId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "artifact_apps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "artifact_app_versions" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "manifest" JSONB NOT NULL,
    "storagePath" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "artifact_app_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "artifact_app_restores" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "fromVersionId" TEXT,
    "fromVersionNumber" INTEGER,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "artifact_app_restores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "artifact_app_agent_runs" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "appId" TEXT,
    "attachmentId" TEXT,
    "userId" TEXT NOT NULL,
    "runKey" TEXT NOT NULL DEFAULT 'default',
    "conversationId" TEXT NOT NULL,
    "agentSlug" TEXT NOT NULL,
    "sessionId" TEXT,
    "prompt" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "artifact_app_agent_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "artifact_app_records" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "baseKey" TEXT NOT NULL,
    "dynamicKey" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "artifact_app_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design_artifact_shares" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenCiphertext" TEXT NOT NULL,
    "tokenIv" TEXT NOT NULL,
    "tokenAuthTag" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "attachmentId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'design',
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "lastViewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "design_artifact_shares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_requests" (
    "id" TEXT NOT NULL,
    "targetType" TEXT NOT NULL DEFAULT 'agent',
    "agentId" TEXT,
    "agentSlug" TEXT,
    "skillId" TEXT,
    "skillSlug" TEXT,
    "requestType" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reviewerId" TEXT,
    "reviewNote" TEXT,
    "requestedName" TEXT,
    "resultAgentId" TEXT,
    "proposedContent" TEXT,
    "baseContentHash" TEXT,
    "proposedContentHash" TEXT,
    "requestNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "orgId" TEXT NOT NULL,

    CONSTRAINT "agent_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_audit_logs" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "eventType" "AgentAuditEvent" NOT NULL,
    "targetId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skills" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "content" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'seeded',
    "scope" TEXT NOT NULL DEFAULT 'global',
    "ownerUserId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "promotedBy" TEXT,
    "promotedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "orgId" TEXT NOT NULL,

    CONSTRAINT "skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill_files" (
    "id" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "relativePath" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "contentType" TEXT,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skill_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_skills" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,

    CONSTRAINT "agent_skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_collections" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "fileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tools" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL,
    "inputSchema" JSONB NOT NULL DEFAULT '{}',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_tools" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "toolId" TEXT NOT NULL,
    "permission" TEXT NOT NULL DEFAULT 'allow',

    CONSTRAINT "agent_tools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gateways" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gateways_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gateway_identities" (
    "id" TEXT NOT NULL,
    "gatewayId" TEXT NOT NULL,
    "externalUserId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gateway_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mcp_servers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "transport" TEXT NOT NULL DEFAULT 'stdio',
    "credentialSchema" JSONB,
    "credentialForm" JSONB,
    "launchConfigTemplate" JSONB,
    "httpConfigTemplate" JSONB,
    "healthcheckSpec" JSONB,
    "writeToolPolicy" JSONB,
    "connectorMeta" JSONB,
    "isOauth" BOOLEAN NOT NULL DEFAULT false,
    "allowGlobalFallback" BOOLEAN NOT NULL DEFAULT false,
    "forwardFiles" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mcp_servers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mcp_connector_edit_requests" (
    "id" TEXT NOT NULL,
    "mcpServerId" TEXT NOT NULL,
    "proposedByUserId" TEXT NOT NULL,
    "proposedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "proposedFields" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mcp_connector_edit_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "global_mcp_credentials" (
    "id" TEXT NOT NULL,
    "mcpServerId" TEXT NOT NULL,
    "orgId" TEXT,
    "encryptedCreds" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "setByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "global_mcp_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_mcp_connections" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mcpServerId" TEXT NOT NULL,
    "encryptedCreds" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_mcp_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_mcp_connections" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "mcpServerId" TEXT NOT NULL,
    "slug" TEXT NOT NULL DEFAULT 'default',
    "displayName" TEXT,
    "encryptedCreds" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_mcp_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_jobs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "agentSlug" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "context" TEXT,
    "channelId" TEXT,
    "conversationId" TEXT,
    "workspaceId" TEXT,
    "type" TEXT NOT NULL,
    "delayMs" BIGINT,
    "cronExpression" TEXT,
    "maxRuns" INTEGER,
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "bullJobId" TEXT,
    "bullSchedulerId" TEXT,
    "nextRunAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "label" TEXT,
    "replyMode" TEXT NOT NULL DEFAULT 'thread',
    "targetChannelId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "orgId" TEXT NOT NULL,

    CONSTRAINT "scheduled_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_job_runs" (
    "id" TEXT NOT NULL,
    "scheduledJobId" TEXT NOT NULL,
    "sessionId" TEXT,
    "status" TEXT NOT NULL,
    "result" TEXT,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scheduled_job_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subagent_definitions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "progressLabels" JSONB NOT NULL,
    "systemPrompt" TEXT NOT NULL,
    "paramName" TEXT NOT NULL DEFAULT 'question',
    "paramDescription" TEXT NOT NULL,
    "tools" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "mcpInstanceMap" JSONB,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "orgId" TEXT NOT NULL,

    CONSTRAINT "subagent_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subagent_shares" (
    "id" TEXT NOT NULL,
    "subagentDefinitionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'EDITOR',
    "sharedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subagent_shares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subagent_skills" (
    "id" TEXT NOT NULL,
    "subagentDefinitionId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,

    CONSTRAINT "subagent_skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subagent_mcp_connections" (
    "id" TEXT NOT NULL,
    "subagentDefinitionId" TEXT NOT NULL,
    "mcpServerId" TEXT NOT NULL,
    "slug" TEXT NOT NULL DEFAULT 'default',
    "displayName" TEXT,
    "nonOverridable" BOOLEAN NOT NULL DEFAULT true,
    "encryptedCreds" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subagent_mcp_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pending_memory_reviews" (
    "id" TEXT NOT NULL,
    "agentSlug" TEXT NOT NULL,
    "userId" TEXT,
    "hindsightMemoryId" TEXT,
    "content" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "category" TEXT,
    "sessionId" TEXT,
    "subsystem" TEXT,
    "action" TEXT,
    "replacesMemoryId" TEXT,
    "isNewSubsystem" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "spacesMessageId" TEXT,
    "curatorReasoning" TEXT,
    "curatorConfidence" DOUBLE PRECISION,
    "tokensIn" INTEGER,
    "tokensOut" INTEGER,
    "toolCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "orgId" TEXT NOT NULL,

    CONSTRAINT "pending_memory_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pending_batch_reviews" (
    "id" TEXT NOT NULL,
    "agentSlug" TEXT NOT NULL,
    "reviewDate" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "sessionIds" TEXT[],
    "approvedSessionIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "heuristicSkipped" JSONB,
    "spacesMessageId" TEXT,
    "retainedMemoryIds" JSONB,
    "approvalStrategy" TEXT NOT NULL DEFAULT 'HUMAN_ONLY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "orgId" TEXT NOT NULL,

    CONSTRAINT "pending_batch_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memory_recall_hits" (
    "id" TEXT NOT NULL,
    "agentSlug" TEXT NOT NULL,
    "hindsightMemoryId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "rank" INTEGER,
    "recalledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "orgId" TEXT NOT NULL,

    CONSTRAINT "memory_recall_hits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "active_goals" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "channelId" TEXT,
    "workspaceId" TEXT,
    "userId" TEXT NOT NULL,
    "agentSlug" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "turnCount" INTEGER NOT NULL DEFAULT 0,
    "maxTurns" INTEGER NOT NULL DEFAULT 5,
    "lastTurnResult" TEXT,
    "lastReason" TEXT,
    "runPayload" JSONB NOT NULL,
    "auditState" TEXT NOT NULL DEFAULT 'none',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "orgId" TEXT NOT NULL,

    CONSTRAINT "active_goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "experiment_runs" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "agentSlug" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "focus" TEXT,
    "provider" TEXT,
    "modelId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'experiment',
    "status" TEXT NOT NULL DEFAULT 'running',
    "epoch" INTEGER NOT NULL DEFAULT 1,
    "deadlineAt" TIMESTAMP(3) NOT NULL,
    "currentHypothesis" TEXT,
    "currentSessionId" TEXT,
    "lastEpochEndedAt" TIMESTAMP(3),
    "sandboxNote" TEXT,
    "deliveredArtifacts" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "checkerSessionIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "finalReport" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "experiment_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "experiment_findings" (
    "id" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "epoch" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "hypothesis" TEXT NOT NULL,
    "note" TEXT,
    "proofArtifactPath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "experiment_findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "experiment_reviews" (
    "id" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "findingId" TEXT NOT NULL,
    "epoch" INTEGER NOT NULL,
    "verdict" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "duplicateOf" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "experiment_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_improvement_candidates" (
    "id" TEXT NOT NULL,
    "agentSlug" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "rootCause" TEXT NOT NULL,
    "finding" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "proposedFix" JSONB NOT NULL,
    "confidence" TEXT NOT NULL DEFAULT 'medium',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "orgId" TEXT NOT NULL,

    CONSTRAINT "agent_improvement_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_curator_state" (
    "agentSlug" TEXT NOT NULL,
    "lastProcessedAt" TIMESTAMP(3) NOT NULL,
    "lastRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invocationCount" INTEGER NOT NULL DEFAULT 0,
    "candidateCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "orgId" TEXT NOT NULL,

    CONSTRAINT "agent_curator_state_pkey" PRIMARY KEY ("agentSlug")
);

-- CreateTable
CREATE TABLE "eval_folders" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "source" TEXT,
    "sourceKind" TEXT,
    "sourceChannelId" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "eval_folders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eval_conversations" (
    "id" TEXT NOT NULL,
    "folderId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "turns" JSONB NOT NULL,
    "source" TEXT,
    "externalId" TEXT,
    "externalUpdatedAt" TIMESTAMP(3),
    "lastMessageId" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "eval_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eval_generations" (
    "id" TEXT NOT NULL,
    "agentSlug" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "genProvider" TEXT,
    "genModel" TEXT,
    "conversationIds" TEXT[],
    "folderId" TEXT,
    "createdBy" TEXT,
    "comparisonId" TEXT,
    "comparisonSeq" INTEGER,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "orgId" TEXT NOT NULL,

    CONSTRAINT "eval_generations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eval_generated_turns" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "turnIndex" INTEGER NOT NULL,
    "inputMessage" TEXT NOT NULL,
    "expectedResponse" TEXT,
    "clawAnswer" TEXT,
    "reasoning" TEXT,
    "toolInvocations" JSONB,
    "status" TEXT NOT NULL DEFAULT 'running',
    "clawConversationId" TEXT,
    "sessionId" TEXT,
    "matchScore" INTEGER,
    "judgeReasoning" TEXT,
    "judgeModel" TEXT,
    "judgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "eval_generated_turns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eval_judges" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "model" TEXT NOT NULL DEFAULT '',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "eval_judges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eval_verdicts" (
    "id" TEXT NOT NULL,
    "turnResultId" TEXT NOT NULL,
    "judgeId" TEXT NOT NULL,
    "judgeName" TEXT NOT NULL,
    "score" INTEGER,
    "reasoning" TEXT,
    "status" TEXT NOT NULL DEFAULT 'scored',
    "model" TEXT NOT NULL DEFAULT 'default',
    "passId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "eval_verdicts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_eval_sheets" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "orgId" TEXT NOT NULL,
    "permissionMode" TEXT NOT NULL DEFAULT 'with',
    "asOfTimestamp" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_eval_sheets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_eval_queries" (
    "id" TEXT NOT NULL,
    "sheetId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "goldAnswer" TEXT,
    "goldId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_eval_queries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_eval_runs" (
    "id" TEXT NOT NULL,
    "sheetId" TEXT NOT NULL,
    "queryType" TEXT[],
    "rankProfile" TEXT,
    "rankProfileInputs" JSONB,
    "permissionMode" TEXT NOT NULL,
    "asOfTimestamp" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'running',
    "createdBy" TEXT,
    "orgId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "queriesScored" INTEGER,
    "top1Count" INTEGER,
    "top1Pct" DOUBLE PRECISION,
    "top3Count" INTEGER,
    "top3Pct" DOUBLE PRECISION,
    "top10Count" INTEGER,
    "top10Pct" DOUBLE PRECISION,
    "mrr" DOUBLE PRECISION,

    CONSTRAINT "search_eval_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_eval_results" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "queryId" TEXT NOT NULL,
    "hit" BOOLEAN NOT NULL DEFAULT false,
    "rank" INTEGER,
    "topResults" JSONB NOT NULL,
    "debug" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_eval_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_registry" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "tenant_unique_id" TEXT NOT NULL,
    "service_name" TEXT NOT NULL,
    "backend_id" TEXT NOT NULL,
    "backend_url" TEXT NOT NULL,
    "tools" JSONB NOT NULL,
    "x_auth_header_name" TEXT,
    "token_endpoint_url" TEXT,
    "registered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_registry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gateway_service_requests" (
    "id" TEXT NOT NULL,
    "tenant_unique_id" TEXT NOT NULL,
    "org_id" TEXT,
    "service_name" TEXT NOT NULL,
    "backend_id" TEXT NOT NULL,
    "backend_url" TEXT NOT NULL,
    "token_endpoint_url" TEXT,
    "x_auth_header_name" TEXT,
    "tools" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "requested_by_user_id" TEXT NOT NULL,
    "reviewed_by_user_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gateway_service_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "error_buckets" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "markers" TEXT NOT NULL DEFAULT '',
    "matchOrder" INTEGER NOT NULL DEFAULT 20,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "error_buckets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entity_type_definitions" (
    "workspaceId" TEXT,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "rule" TEXT NOT NULL,
    "examples" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "proposedInRunId" TEXT,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "deprecatedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entity_type_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entity_extraction_runs" (
    "workspaceId" TEXT,
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "stage" TEXT NOT NULL DEFAULT 'FETCHING_MESSAGES',
    "settings" JSONB NOT NULL,
    "proposedTypes" JSONB,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "documentCount" INTEGER NOT NULL DEFAULT 0,
    "approvedTypeNames" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "triggeredByUserId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,

    CONSTRAINT "entity_extraction_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_awakening_state" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "nextDueAt" TIMESTAMP(3) NOT NULL,
    "lastTickAt" TIMESTAMP(3),
    "watermarkAt" TIMESTAMP(3) NOT NULL,
    "watermarkMessageId" TEXT,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "consecutiveSkips" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "reflexNextCheckAt" TIMESTAMP(3),
    "reflexWatermarkAt" TIMESTAMP(3),
    "reflexLastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_awakening_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_awakening_runs" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "windowStartMs" BIGINT NOT NULL,
    "windowEndMs" BIGINT NOT NULL,
    "outcome" TEXT NOT NULL,
    "skipReason" TEXT,
    "eventCount" INTEGER NOT NULL DEFAULT 0,
    "signals" JSONB,
    "sessionId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "artifactUri" TEXT,
    "injectionsUsed" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "agent_awakening_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_artifacts" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "messageId" TEXT,
    "runId" TEXT,
    "kind" TEXT NOT NULL,
    "refService" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "url" TEXT,
    "provider" TEXT,
    "latestVersionRef" TEXT,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversation_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_orgId_key" ON "users"("email", "orgId");

-- CreateIndex
CREATE INDEX "agent_memory_files_agentSlug_userId_loadInPrompt_idx" ON "agent_memory_files"("agentSlug", "userId", "loadInPrompt");

-- CreateIndex
CREATE UNIQUE INDEX "agent_memory_files_orgId_agentSlug_userId_name_key" ON "agent_memory_files"("orgId", "agentSlug", "userId", "name");

-- CreateIndex
CREATE INDEX "twin_behavior_signals_userId_occurredAt_idx" ON "twin_behavior_signals"("userId", "occurredAt");

-- CreateIndex
CREATE INDEX "twin_behavior_signals_userId_outcome_idx" ON "twin_behavior_signals"("userId", "outcome");

-- CreateIndex
CREATE INDEX "twin_behavior_signals_userId_channelType_outcome_idx" ON "twin_behavior_signals"("userId", "channelType", "outcome");

-- CreateIndex
CREATE INDEX "twin_behavior_signals_userId_shouldHaveResponded_idx" ON "twin_behavior_signals"("userId", "shouldHaveResponded");

-- CreateIndex
CREATE UNIQUE INDEX "twin_behavior_signals_userId_sourceMessageId_key" ON "twin_behavior_signals"("userId", "sourceMessageId");

-- CreateIndex
CREATE INDEX "twin_response_feedback_userId_status_idx" ON "twin_response_feedback"("userId", "status");

-- CreateIndex
CREATE INDEX "twin_response_feedback_userId_decidedAt_idx" ON "twin_response_feedback"("userId", "decidedAt");

-- CreateIndex
CREATE INDEX "twin_response_feedback_status_proposedAt_idx" ON "twin_response_feedback"("status", "proposedAt");

-- CreateIndex
CREATE UNIQUE INDEX "twin_response_feedback_userId_sourceMessageId_key" ON "twin_response_feedback"("userId", "sourceMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_name_key" ON "organizations"("name");

-- CreateIndex
CREATE UNIQUE INDEX "surfaces_key_key" ON "surfaces"("key");

-- CreateIndex
CREATE INDEX "connected_surfaces_orgId_idx" ON "connected_surfaces"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "connected_surfaces_orgId_surfaceId_surfaceTenantId_key" ON "connected_surfaces"("orgId", "surfaceId", "surfaceTenantId");

-- CreateIndex
CREATE INDEX "channel_auth_state_connectedSurfaceId_idx" ON "channel_auth_state"("connectedSurfaceId");

-- CreateIndex
CREATE UNIQUE INDEX "channel_auth_state_connectedSurfaceId_category_keyId_key" ON "channel_auth_state"("connectedSurfaceId", "category", "keyId");

-- CreateIndex
CREATE INDEX "user_surface_identities_orgId_idx" ON "user_surface_identities"("orgId");

-- CreateIndex
CREATE INDEX "user_surface_identities_userId_idx" ON "user_surface_identities"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_surface_identities_surfaceId_surfaceWorkspaceId_surfac_key" ON "user_surface_identities"("surfaceId", "surfaceWorkspaceId", "surfaceUserId");

-- CreateIndex
CREATE INDEX "surface_agents_surfaceId_idx" ON "surface_agents"("surfaceId");

-- CreateIndex
CREATE UNIQUE INDEX "surface_agents_agentId_surfaceId_surfaceTenantId_key" ON "surface_agents"("agentId", "surfaceId", "surfaceTenantId");

-- CreateIndex
CREATE UNIQUE INDEX "surface_agents_surfaceId_externalAppId_key" ON "surface_agents"("surfaceId", "externalAppId");

-- CreateIndex
CREATE UNIQUE INDEX "surface_agent_installs_surfaceAgentId_surfaceTenantId_key" ON "surface_agent_installs"("surfaceAgentId", "surfaceTenantId");

-- CreateIndex
CREATE UNIQUE INDEX "surface_access_tokens_tokenHash_key" ON "surface_access_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "surface_access_tokens_userId_surfaceId_idx" ON "surface_access_tokens"("userId", "surfaceId");

-- CreateIndex
CREATE INDEX "surface_access_tokens_orgId_idx" ON "surface_access_tokens"("orgId");

-- CreateIndex
CREATE INDEX "surface_tenant_links_orgId_idx" ON "surface_tenant_links"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "surface_tenant_links_surfaceType_surfaceTenantId_key" ON "surface_tenant_links"("surfaceType", "surfaceTenantId");

-- CreateIndex
CREATE INDEX "org_members_orgId_idx" ON "org_members"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "org_members_userId_orgId_key" ON "org_members"("userId", "orgId");

-- CreateIndex
CREATE INDEX "user_memory_candidates_userId_status_idx" ON "user_memory_candidates"("userId", "status");

-- CreateIndex
CREATE INDEX "user_memory_candidates_userId_subsystem_status_idx" ON "user_memory_candidates"("userId", "subsystem", "status");

-- CreateIndex
CREATE INDEX "user_memory_candidates_hindsightMemoryId_idx" ON "user_memory_candidates"("hindsightMemoryId");

-- CreateIndex
CREATE INDEX "digital_twin_pipeline_events_userId_createdAt_idx" ON "digital_twin_pipeline_events"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "digital_twin_pipeline_events_userId_runType_createdAt_idx" ON "digital_twin_pipeline_events"("userId", "runType", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "user_roles_userId_role_key" ON "user_roles"("userId", "role");

-- CreateIndex
CREATE INDEX "user_agent_configs_orgId_idx" ON "user_agent_configs"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "user_agent_configs_userId_orgId_agentSlug_key" ON "user_agent_configs"("userId", "orgId", "agentSlug");

-- CreateIndex
CREATE INDEX "user_agent_instructions_orgId_idx" ON "user_agent_instructions"("orgId");

-- CreateIndex
CREATE INDEX "user_agent_instructions_userId_idx" ON "user_agent_instructions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_agent_instructions_userId_orgId_agentSlug_key" ON "user_agent_instructions"("userId", "orgId", "agentSlug");

-- CreateIndex
CREATE INDEX "generated_content_orgId_idx" ON "generated_content"("orgId");

-- CreateIndex
CREATE INDEX "generated_content_userId_kind_dateBucket_idx" ON "generated_content"("userId", "kind", "dateBucket");

-- CreateIndex
CREATE INDEX "generated_content_status_kind_idx" ON "generated_content"("status", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "generated_content_userId_kind_dateBucket_key" ON "generated_content"("userId", "kind", "dateBucket");

-- CreateIndex
CREATE INDEX "daily_brief_activity_orgId_idx" ON "daily_brief_activity"("orgId");

-- CreateIndex
CREATE INDEX "daily_brief_activity_kind_dateBucket_idx" ON "daily_brief_activity"("kind", "dateBucket");

-- CreateIndex
CREATE UNIQUE INDEX "daily_brief_activity_userId_kind_dateBucket_key" ON "daily_brief_activity"("userId", "kind", "dateBucket");

-- CreateIndex
CREATE UNIQUE INDEX "agent_chain_workflows_agentTriggerSlug_key" ON "agent_chain_workflows"("agentTriggerSlug");

-- CreateIndex
CREATE UNIQUE INDEX "agent_chain_workflows_createdByUserId_name_key" ON "agent_chain_workflows"("createdByUserId", "name");

-- CreateIndex
CREATE INDEX "workflow_global_requests_status_createdAt_idx" ON "workflow_global_requests"("status", "createdAt");

-- CreateIndex
CREATE INDEX "workflow_global_requests_workflowId_status_idx" ON "workflow_global_requests"("workflowId", "status");

-- CreateIndex
CREATE INDEX "channel_agent_chain_bindings_workflowId_idx" ON "channel_agent_chain_bindings"("workflowId");

-- CreateIndex
CREATE INDEX "channel_agent_chain_bindings_channelId_idx" ON "channel_agent_chain_bindings"("channelId");

-- CreateIndex
CREATE INDEX "channel_agent_chain_bindings_userId_idx" ON "channel_agent_chain_bindings"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "channel_agent_chain_bindings_channelId_entryAgentSlug_userI_key" ON "channel_agent_chain_bindings"("channelId", "entryAgentSlug", "userId");

-- CreateIndex
CREATE INDEX "user_provider_credentials_sharedCredentialId_idx" ON "user_provider_credentials"("sharedCredentialId");

-- CreateIndex
CREATE UNIQUE INDEX "local_harness_devices_tokenHash_key" ON "local_harness_devices"("tokenHash");

-- CreateIndex
CREATE INDEX "local_harness_devices_userId_revokedAt_idx" ON "local_harness_devices"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "artifact_comments_artifactId_createdAt_idx" ON "artifact_comments"("artifactId", "createdAt");

-- CreateIndex
CREATE INDEX "artifact_comments_conversationId_createdAt_idx" ON "artifact_comments"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "artifact_comments_orgId_idx" ON "artifact_comments"("orgId");

-- CreateIndex
CREATE INDEX "surface_calls_deviceId_status_createdAt_idx" ON "surface_calls"("deviceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "surface_calls_userId_createdAt_idx" ON "surface_calls"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "surface_calls_orgId_idx" ON "surface_calls"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "local_harness_runs_sessionId_key" ON "local_harness_runs"("sessionId");

-- CreateIndex
CREATE INDEX "local_harness_runs_userId_status_createdAt_idx" ON "local_harness_runs"("userId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "local_harness_runs_status_expiresAt_idx" ON "local_harness_runs"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "local_harness_runs_pendingActionId_idx" ON "local_harness_runs"("pendingActionId");

-- CreateIndex
CREATE INDEX "local_harness_sessions_userId_updatedAt_idx" ON "local_harness_sessions"("userId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "local_harness_sessions_conversationId_provider_key" ON "local_harness_sessions"("conversationId", "provider");

-- CreateIndex
CREATE INDEX "agent_provider_credentials_createdByUserId_idx" ON "agent_provider_credentials"("createdByUserId");

-- CreateIndex
CREATE INDEX "agent_provider_credentials_sharedCredentialId_idx" ON "agent_provider_credentials"("sharedCredentialId");

-- CreateIndex
CREATE INDEX "shared_provider_credentials_orgId_idx" ON "shared_provider_credentials"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "shared_provider_credentials_orgId_provider_name_key" ON "shared_provider_credentials"("orgId", "provider", "name");

-- CreateIndex
CREATE UNIQUE INDEX "agents_spacesAppId_key" ON "agents"("spacesAppId");

-- CreateIndex
CREATE INDEX "agents_orgId_idx" ON "agents"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "agents_orgId_slug_key" ON "agents"("orgId", "slug");

-- CreateIndex
CREATE INDEX "agent_delegation_grants_callerAgentId_idx" ON "agent_delegation_grants"("callerAgentId");

-- CreateIndex
CREATE INDEX "agent_delegation_grants_calleeAgentId_status_idx" ON "agent_delegation_grants"("calleeAgentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "agent_delegation_grants_callerAgentId_calleeAgentId_key" ON "agent_delegation_grants"("callerAgentId", "calleeAgentId");

-- CreateIndex
CREATE INDEX "agent_prompt_versions_agentId_createdAt_idx" ON "agent_prompt_versions"("agentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "agent_prompt_versions_agentId_version_key" ON "agent_prompt_versions"("agentId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "agent_shares_agentId_userId_key" ON "agent_shares"("agentId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "agent_runs_sessionId_key" ON "agent_runs"("sessionId");

-- CreateIndex
CREATE INDEX "agent_runs_userId_status_startedAt_idx" ON "agent_runs"("userId", "status", "startedAt");

-- CreateIndex
CREATE INDEX "agent_runs_parentSessionId_idx" ON "agent_runs"("parentSessionId");

-- CreateIndex
CREATE INDEX "agent_runs_agentSlug_startedAt_idx" ON "agent_runs"("agentSlug", "startedAt");

-- CreateIndex
CREATE INDEX "agent_runs_provider_completedAt_idx" ON "agent_runs"("provider", "completedAt");

-- CreateIndex
CREATE INDEX "agent_runs_chatMessageId_idx" ON "agent_runs"("chatMessageId");

-- CreateIndex
CREATE INDEX "agent_runs_orgId_idx" ON "agent_runs"("orgId");

-- CreateIndex
CREATE INDEX "agent_runs_completedAt_triggerSource_idx" ON "agent_runs"("completedAt", "triggerSource");

-- CreateIndex
CREATE INDEX "agent_runs_userId_startedAt_idx" ON "agent_runs"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "agent_runs_orgId_startedAt_idx" ON "agent_runs"("orgId", "startedAt");

-- CreateIndex
CREATE INDEX "agent_widget_bindings_kind_externalKey_idx" ON "agent_widget_bindings"("kind", "externalKey");

-- CreateIndex
CREATE INDEX "agent_widget_bindings_orgId_idx" ON "agent_widget_bindings"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "agent_widget_bindings_kind_screenId_key" ON "agent_widget_bindings"("kind", "screenId");

-- CreateIndex
CREATE INDEX "chat_messages_conversationId_createdAt_idx" ON "chat_messages"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "chat_messages_userId_agentSlug_idx" ON "chat_messages"("userId", "agentSlug");

-- CreateIndex
CREATE INDEX "chat_messages_orgId_idx" ON "chat_messages"("orgId");

-- CreateIndex
CREATE INDEX "chat_attachments_chatMessageId_idx" ON "chat_attachments"("chatMessageId");

-- CreateIndex
CREATE INDEX "chat_attachments_uploaderUserId_createdAt_idx" ON "chat_attachments"("uploaderUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "artifact_apps_conversationId_key" ON "artifact_apps"("conversationId");

-- CreateIndex
CREATE INDEX "artifact_apps_workspaceId_visibility_idx" ON "artifact_apps"("workspaceId", "visibility");

-- CreateIndex
CREATE INDEX "artifact_apps_ownerUserId_idx" ON "artifact_apps"("ownerUserId");

-- CreateIndex
CREATE INDEX "artifact_app_versions_appId_createdAt_idx" ON "artifact_app_versions"("appId", "createdAt");

-- CreateIndex
CREATE INDEX "artifact_app_versions_workspaceId_idx" ON "artifact_app_versions"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "artifact_app_versions_appId_contentHash_key" ON "artifact_app_versions"("appId", "contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "artifact_app_versions_appId_versionNumber_key" ON "artifact_app_versions"("appId", "versionNumber");

-- CreateIndex
CREATE INDEX "artifact_app_restores_appId_createdAt_idx" ON "artifact_app_restores"("appId", "createdAt");

-- CreateIndex
CREATE INDEX "artifact_app_restores_workspaceId_idx" ON "artifact_app_restores"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "artifact_app_agent_runs_sessionId_key" ON "artifact_app_agent_runs"("sessionId");

-- CreateIndex
CREATE INDEX "artifact_app_agent_runs_appId_userId_runKey_idx" ON "artifact_app_agent_runs"("appId", "userId", "runKey");

-- CreateIndex
CREATE INDEX "artifact_app_agent_runs_userId_status_idx" ON "artifact_app_agent_runs"("userId", "status");

-- CreateIndex
CREATE INDEX "artifact_app_agent_runs_conversationId_idx" ON "artifact_app_agent_runs"("conversationId");

-- CreateIndex
CREATE INDEX "artifact_app_agent_runs_workspaceId_idx" ON "artifact_app_agent_runs"("workspaceId");

-- CreateIndex
CREATE INDEX "artifact_app_records_workspaceId_appId_idx" ON "artifact_app_records"("workspaceId", "appId");

-- CreateIndex
CREATE UNIQUE INDEX "artifact_app_records_workspaceId_appId_baseKey_owner_dynami_key" ON "artifact_app_records"("workspaceId", "appId", "baseKey", "owner", "dynamicKey");

-- CreateIndex
CREATE UNIQUE INDEX "design_artifact_shares_tokenHash_key" ON "design_artifact_shares"("tokenHash");

-- CreateIndex
CREATE INDEX "design_artifact_shares_orgId_updatedAt_idx" ON "design_artifact_shares"("orgId", "updatedAt");

-- CreateIndex
CREATE INDEX "design_artifact_shares_attachmentId_idx" ON "design_artifact_shares"("attachmentId");

-- CreateIndex
CREATE UNIQUE INDEX "design_artifact_shares_ownerUserId_conversationId_key" ON "design_artifact_shares"("ownerUserId", "conversationId");

-- CreateIndex
CREATE INDEX "agent_requests_status_idx" ON "agent_requests"("status");

-- CreateIndex
CREATE INDEX "agent_requests_requesterId_idx" ON "agent_requests"("requesterId");

-- CreateIndex
CREATE INDEX "agent_requests_agentId_idx" ON "agent_requests"("agentId");

-- CreateIndex
CREATE INDEX "agent_requests_orgId_idx" ON "agent_requests"("orgId");

-- CreateIndex
CREATE INDEX "skills_orgId_idx" ON "skills"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "skills_orgId_slug_key" ON "skills"("orgId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "skill_files_skillId_relativePath_key" ON "skill_files"("skillId", "relativePath");

-- CreateIndex
CREATE UNIQUE INDEX "agent_skills_agentId_skillId_key" ON "agent_skills"("agentId", "skillId");

-- CreateIndex
CREATE INDEX "agent_collections_agentId_idx" ON "agent_collections"("agentId");

-- CreateIndex
CREATE UNIQUE INDEX "agent_collections_agentId_collectionId_fileId_key" ON "agent_collections"("agentId", "collectionId", "fileId");

-- CreateIndex
CREATE UNIQUE INDEX "tools_slug_key" ON "tools"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "agent_tools_agentId_toolId_key" ON "agent_tools"("agentId", "toolId");

-- CreateIndex
CREATE UNIQUE INDEX "gateways_type_key" ON "gateways"("type");

-- CreateIndex
CREATE UNIQUE INDEX "gateway_identities_gatewayId_externalUserId_key" ON "gateway_identities"("gatewayId", "externalUserId");

-- CreateIndex
CREATE INDEX "mcp_servers_enabled_idx" ON "mcp_servers"("enabled");

-- CreateIndex
CREATE INDEX "mcp_servers_transport_idx" ON "mcp_servers"("transport");

-- CreateIndex
CREATE UNIQUE INDEX "mcp_servers_type_key" ON "mcp_servers"("type");

-- CreateIndex
CREATE INDEX "mcp_connector_edit_requests_mcpServerId_status_idx" ON "mcp_connector_edit_requests"("mcpServerId", "status");

-- CreateIndex
CREATE INDEX "mcp_connector_edit_requests_status_createdAt_idx" ON "mcp_connector_edit_requests"("status", "createdAt");

-- CreateIndex
CREATE INDEX "global_mcp_credentials_mcpServerId_idx" ON "global_mcp_credentials"("mcpServerId");

-- CreateIndex
CREATE UNIQUE INDEX "global_mcp_credentials_mcpServerId_orgId_key" ON "global_mcp_credentials"("mcpServerId", "orgId");

-- CreateIndex
CREATE UNIQUE INDEX "user_mcp_connections_userId_mcpServerId_key" ON "user_mcp_connections"("userId", "mcpServerId");

-- CreateIndex
CREATE INDEX "agent_mcp_connections_agentId_idx" ON "agent_mcp_connections"("agentId");

-- CreateIndex
CREATE UNIQUE INDEX "agent_mcp_connections_agentId_mcpServerId_slug_key" ON "agent_mcp_connections"("agentId", "mcpServerId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "scheduled_jobs_bullSchedulerId_key" ON "scheduled_jobs"("bullSchedulerId");

-- CreateIndex
CREATE INDEX "scheduled_jobs_status_idx" ON "scheduled_jobs"("status");

-- CreateIndex
CREATE INDEX "scheduled_jobs_userId_idx" ON "scheduled_jobs"("userId");

-- CreateIndex
CREATE INDEX "scheduled_jobs_agentSlug_idx" ON "scheduled_jobs"("agentSlug");

-- CreateIndex
CREATE INDEX "scheduled_jobs_orgId_idx" ON "scheduled_jobs"("orgId");

-- CreateIndex
CREATE INDEX "scheduled_job_runs_scheduledJobId_idx" ON "scheduled_job_runs"("scheduledJobId");

-- CreateIndex
CREATE INDEX "subagent_definitions_orgId_idx" ON "subagent_definitions"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "subagent_definitions_orgId_name_key" ON "subagent_definitions"("orgId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "subagent_shares_subagentDefinitionId_userId_key" ON "subagent_shares"("subagentDefinitionId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "subagent_skills_subagentDefinitionId_skillId_key" ON "subagent_skills"("subagentDefinitionId", "skillId");

-- CreateIndex
CREATE INDEX "subagent_mcp_connections_subagentDefinitionId_idx" ON "subagent_mcp_connections"("subagentDefinitionId");

-- CreateIndex
CREATE UNIQUE INDEX "subagent_mcp_connections_subagentDefinitionId_mcpServerId_s_key" ON "subagent_mcp_connections"("subagentDefinitionId", "mcpServerId", "slug");

-- CreateIndex
CREATE INDEX "pending_memory_reviews_status_idx" ON "pending_memory_reviews"("status");

-- CreateIndex
CREATE INDEX "pending_memory_reviews_agentSlug_idx" ON "pending_memory_reviews"("agentSlug");

-- CreateIndex
CREATE INDEX "pending_memory_reviews_agentSlug_status_idx" ON "pending_memory_reviews"("agentSlug", "status");

-- CreateIndex
CREATE INDEX "pending_memory_reviews_orgId_idx" ON "pending_memory_reviews"("orgId");

-- CreateIndex
CREATE INDEX "pending_batch_reviews_status_idx" ON "pending_batch_reviews"("status");

-- CreateIndex
CREATE INDEX "pending_batch_reviews_agentSlug_status_idx" ON "pending_batch_reviews"("agentSlug", "status");

-- CreateIndex
CREATE INDEX "pending_batch_reviews_orgId_idx" ON "pending_batch_reviews"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "pending_batch_reviews_agentSlug_reviewDate_key" ON "pending_batch_reviews"("agentSlug", "reviewDate");

-- CreateIndex
CREATE INDEX "memory_recall_hits_agentSlug_recalledAt_idx" ON "memory_recall_hits"("agentSlug", "recalledAt");

-- CreateIndex
CREATE INDEX "memory_recall_hits_hindsightMemoryId_idx" ON "memory_recall_hits"("hindsightMemoryId");

-- CreateIndex
CREATE INDEX "memory_recall_hits_orgId_idx" ON "memory_recall_hits"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "active_goals_conversationId_key" ON "active_goals"("conversationId");

-- CreateIndex
CREATE INDEX "active_goals_userId_status_idx" ON "active_goals"("userId", "status");

-- CreateIndex
CREATE INDEX "active_goals_status_updatedAt_idx" ON "active_goals"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "active_goals_orgId_idx" ON "active_goals"("orgId");

-- CreateIndex
CREATE INDEX "experiment_runs_conversationId_status_idx" ON "experiment_runs"("conversationId", "status");

-- CreateIndex
CREATE INDEX "experiment_findings_experimentId_idx" ON "experiment_findings"("experimentId");

-- CreateIndex
CREATE INDEX "experiment_reviews_experimentId_idx" ON "experiment_reviews"("experimentId");

-- CreateIndex
CREATE UNIQUE INDEX "experiment_reviews_findingId_epoch_key" ON "experiment_reviews"("findingId", "epoch");

-- CreateIndex
CREATE INDEX "agent_improvement_candidates_agentSlug_status_updatedAt_idx" ON "agent_improvement_candidates"("agentSlug", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "agent_improvement_candidates_status_createdAt_idx" ON "agent_improvement_candidates"("status", "createdAt");

-- CreateIndex
CREATE INDEX "agent_improvement_candidates_orgId_idx" ON "agent_improvement_candidates"("orgId");

-- CreateIndex
CREATE INDEX "agent_curator_state_orgId_idx" ON "agent_curator_state"("orgId");

-- CreateIndex
CREATE INDEX "eval_folders_sourceChannelId_idx" ON "eval_folders"("sourceChannelId");

-- CreateIndex
CREATE INDEX "eval_conversations_folderId_createdAt_idx" ON "eval_conversations"("folderId", "createdAt");

-- CreateIndex
CREATE INDEX "eval_generations_folderId_startedAt_idx" ON "eval_generations"("folderId", "startedAt");

-- CreateIndex
CREATE INDEX "eval_generations_orgId_idx" ON "eval_generations"("orgId");

-- CreateIndex
CREATE INDEX "eval_generations_comparisonId_idx" ON "eval_generations"("comparisonId");

-- CreateIndex
CREATE INDEX "eval_generated_turns_runId_idx" ON "eval_generated_turns"("runId");

-- CreateIndex
CREATE INDEX "eval_generated_turns_conversationId_idx" ON "eval_generated_turns"("conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "eval_generated_turns_runId_conversationId_turnIndex_key" ON "eval_generated_turns"("runId", "conversationId", "turnIndex");

-- CreateIndex
CREATE INDEX "eval_verdicts_turnResultId_idx" ON "eval_verdicts"("turnResultId");

-- CreateIndex
CREATE UNIQUE INDEX "eval_verdicts_turnResultId_judgeId_model_key" ON "eval_verdicts"("turnResultId", "judgeId", "model");

-- CreateIndex
CREATE INDEX "search_eval_sheets_orgId_idx" ON "search_eval_sheets"("orgId");

-- CreateIndex
CREATE INDEX "search_eval_queries_sheetId_idx" ON "search_eval_queries"("sheetId");

-- CreateIndex
CREATE INDEX "search_eval_runs_sheetId_startedAt_idx" ON "search_eval_runs"("sheetId", "startedAt");

-- CreateIndex
CREATE INDEX "search_eval_runs_orgId_idx" ON "search_eval_runs"("orgId");

-- CreateIndex
CREATE INDEX "search_eval_results_runId_idx" ON "search_eval_results"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "search_eval_results_runId_queryId_key" ON "search_eval_results"("runId", "queryId");

-- CreateIndex
CREATE INDEX "service_registry_tenant_unique_id_idx" ON "service_registry"("tenant_unique_id");

-- CreateIndex
CREATE INDEX "service_registry_service_name_idx" ON "service_registry"("service_name");

-- CreateIndex
CREATE INDEX "service_registry_tenant_unique_id_service_name_idx" ON "service_registry"("tenant_unique_id", "service_name");

-- CreateIndex
CREATE UNIQUE INDEX "service_registry_tenant_unique_id_service_name_backend_id_key" ON "service_registry"("tenant_unique_id", "service_name", "backend_id");

-- CreateIndex
CREATE INDEX "gateway_service_requests_tenant_unique_id_status_idx" ON "gateway_service_requests"("tenant_unique_id", "status");

-- CreateIndex
CREATE INDEX "gateway_service_requests_requested_by_user_id_idx" ON "gateway_service_requests"("requested_by_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "error_buckets_name_key" ON "error_buckets"("name");

-- CreateIndex
CREATE INDEX "error_buckets_enabled_matchOrder_idx" ON "error_buckets"("enabled", "matchOrder");

-- CreateIndex
CREATE INDEX "entity_type_definitions_workspaceId_status_idx" ON "entity_type_definitions"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "entity_type_definitions_workspaceId_name_key" ON "entity_type_definitions"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "entity_extraction_runs_workspaceId_channelId_status_idx" ON "entity_extraction_runs"("workspaceId", "channelId", "status");

-- CreateIndex
CREATE INDEX "entity_extraction_runs_workspaceId_status_idx" ON "entity_extraction_runs"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "agent_awakening_state_agentId_key" ON "agent_awakening_state"("agentId");

-- CreateIndex
CREATE INDEX "agent_awakening_state_enabled_nextDueAt_idx" ON "agent_awakening_state"("enabled", "nextDueAt");

-- CreateIndex
CREATE INDEX "agent_awakening_state_enabled_reflexNextCheckAt_idx" ON "agent_awakening_state"("enabled", "reflexNextCheckAt");

-- CreateIndex
CREATE INDEX "agent_awakening_state_orgId_idx" ON "agent_awakening_state"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "agent_awakening_runs_idempotencyKey_key" ON "agent_awakening_runs"("idempotencyKey");

-- CreateIndex
CREATE INDEX "agent_awakening_runs_agentId_windowStartMs_idx" ON "agent_awakening_runs"("agentId", "windowStartMs");

-- CreateIndex
CREATE INDEX "agent_awakening_runs_orgId_startedAt_idx" ON "agent_awakening_runs"("orgId", "startedAt");

-- CreateIndex
CREATE INDEX "conversation_artifacts_conversationId_createdAt_idx" ON "conversation_artifacts"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "conversation_artifacts_refService_refId_idx" ON "conversation_artifacts"("refService", "refId");

-- CreateIndex
CREATE INDEX "conversation_artifacts_orgId_idx" ON "conversation_artifacts"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_artifacts_conversationId_kind_refId_key" ON "conversation_artifacts"("conversationId", "kind", "refId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_memory_files" ADD CONSTRAINT "agent_memory_files_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "twin_behavior_signals" ADD CONSTRAINT "twin_behavior_signals_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connected_surfaces" ADD CONSTRAINT "connected_surfaces_surfaceId_fkey" FOREIGN KEY ("surfaceId") REFERENCES "surfaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_auth_state" ADD CONSTRAINT "channel_auth_state_connectedSurfaceId_fkey" FOREIGN KEY ("connectedSurfaceId") REFERENCES "connected_surfaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_surface_identities" ADD CONSTRAINT "user_surface_identities_surfaceId_fkey" FOREIGN KEY ("surfaceId") REFERENCES "surfaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_surface_identities" ADD CONSTRAINT "user_surface_identities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surface_agents" ADD CONSTRAINT "surface_agents_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surface_agents" ADD CONSTRAINT "surface_agents_surfaceId_fkey" FOREIGN KEY ("surfaceId") REFERENCES "surfaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surface_agent_installs" ADD CONSTRAINT "surface_agent_installs_surfaceAgentId_fkey" FOREIGN KEY ("surfaceAgentId") REFERENCES "surface_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surface_access_tokens" ADD CONSTRAINT "surface_access_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surface_access_tokens" ADD CONSTRAINT "surface_access_tokens_surfaceId_fkey" FOREIGN KEY ("surfaceId") REFERENCES "surfaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surface_tenant_links" ADD CONSTRAINT "surface_tenant_links_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_memory_candidates" ADD CONSTRAINT "user_memory_candidates_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "digital_twin_pipeline_events" ADD CONSTRAINT "digital_twin_pipeline_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_agent_configs" ADD CONSTRAINT "user_agent_configs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_agent_instructions" ADD CONSTRAINT "user_agent_instructions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_content" ADD CONSTRAINT "generated_content_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_brief_activity" ADD CONSTRAINT "daily_brief_activity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_chain_workflows" ADD CONSTRAINT "agent_chain_workflows_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_global_requests" ADD CONSTRAINT "workflow_global_requests_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "agent_chain_workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_agent_chain_bindings" ADD CONSTRAINT "channel_agent_chain_bindings_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "agent_chain_workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_agent_chain_bindings" ADD CONSTRAINT "channel_agent_chain_bindings_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_provider_credentials" ADD CONSTRAINT "user_provider_credentials_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_provider_credentials" ADD CONSTRAINT "user_provider_credentials_sharedCredentialId_fkey" FOREIGN KEY ("sharedCredentialId") REFERENCES "shared_provider_credentials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "local_harness_devices" ADD CONSTRAINT "local_harness_devices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surface_calls" ADD CONSTRAINT "surface_calls_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "local_harness_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "local_harness_runs" ADD CONSTRAINT "local_harness_runs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "local_harness_runs" ADD CONSTRAINT "local_harness_runs_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "local_harness_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "local_harness_sessions" ADD CONSTRAINT "local_harness_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_subagent_configs" ADD CONSTRAINT "user_subagent_configs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_provider_credentials" ADD CONSTRAINT "agent_provider_credentials_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_provider_credentials" ADD CONSTRAINT "agent_provider_credentials_sharedCredentialId_fkey" FOREIGN KEY ("sharedCredentialId") REFERENCES "shared_provider_credentials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agents" ADD CONSTRAINT "agents_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agents" ADD CONSTRAINT "agents_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_prompt_versions" ADD CONSTRAINT "agent_prompt_versions_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_shares" ADD CONSTRAINT "agent_shares_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_shares" ADD CONSTRAINT "agent_shares_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_attachments" ADD CONSTRAINT "chat_attachments_chatMessageId_fkey" FOREIGN KEY ("chatMessageId") REFERENCES "chat_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifact_app_versions" ADD CONSTRAINT "artifact_app_versions_appId_fkey" FOREIGN KEY ("appId") REFERENCES "artifact_apps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifact_app_restores" ADD CONSTRAINT "artifact_app_restores_appId_fkey" FOREIGN KEY ("appId") REFERENCES "artifact_apps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifact_app_agent_runs" ADD CONSTRAINT "artifact_app_agent_runs_appId_fkey" FOREIGN KEY ("appId") REFERENCES "artifact_apps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_artifact_shares" ADD CONSTRAINT "design_artifact_shares_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "chat_attachments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skills" ADD CONSTRAINT "skills_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skills" ADD CONSTRAINT "skills_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_files" ADD CONSTRAINT "skill_files_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_skills" ADD CONSTRAINT "agent_skills_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_skills" ADD CONSTRAINT "agent_skills_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_collections" ADD CONSTRAINT "agent_collections_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_tools" ADD CONSTRAINT "agent_tools_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_tools" ADD CONSTRAINT "agent_tools_toolId_fkey" FOREIGN KEY ("toolId") REFERENCES "tools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gateway_identities" ADD CONSTRAINT "gateway_identities_gatewayId_fkey" FOREIGN KEY ("gatewayId") REFERENCES "gateways"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gateway_identities" ADD CONSTRAINT "gateway_identities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mcp_connector_edit_requests" ADD CONSTRAINT "mcp_connector_edit_requests_mcpServerId_fkey" FOREIGN KEY ("mcpServerId") REFERENCES "mcp_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "global_mcp_credentials" ADD CONSTRAINT "global_mcp_credentials_mcpServerId_fkey" FOREIGN KEY ("mcpServerId") REFERENCES "mcp_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_mcp_connections" ADD CONSTRAINT "user_mcp_connections_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_mcp_connections" ADD CONSTRAINT "user_mcp_connections_mcpServerId_fkey" FOREIGN KEY ("mcpServerId") REFERENCES "mcp_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_mcp_connections" ADD CONSTRAINT "agent_mcp_connections_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_mcp_connections" ADD CONSTRAINT "agent_mcp_connections_mcpServerId_fkey" FOREIGN KEY ("mcpServerId") REFERENCES "mcp_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_job_runs" ADD CONSTRAINT "scheduled_job_runs_scheduledJobId_fkey" FOREIGN KEY ("scheduledJobId") REFERENCES "scheduled_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subagent_definitions" ADD CONSTRAINT "subagent_definitions_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subagent_shares" ADD CONSTRAINT "subagent_shares_subagentDefinitionId_fkey" FOREIGN KEY ("subagentDefinitionId") REFERENCES "subagent_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subagent_shares" ADD CONSTRAINT "subagent_shares_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subagent_skills" ADD CONSTRAINT "subagent_skills_subagentDefinitionId_fkey" FOREIGN KEY ("subagentDefinitionId") REFERENCES "subagent_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subagent_skills" ADD CONSTRAINT "subagent_skills_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subagent_mcp_connections" ADD CONSTRAINT "subagent_mcp_connections_subagentDefinitionId_fkey" FOREIGN KEY ("subagentDefinitionId") REFERENCES "subagent_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subagent_mcp_connections" ADD CONSTRAINT "subagent_mcp_connections_mcpServerId_fkey" FOREIGN KEY ("mcpServerId") REFERENCES "mcp_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "experiment_findings" ADD CONSTRAINT "experiment_findings_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "experiment_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "experiment_reviews" ADD CONSTRAINT "experiment_reviews_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "experiment_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "experiment_reviews" ADD CONSTRAINT "experiment_reviews_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "experiment_findings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eval_conversations" ADD CONSTRAINT "eval_conversations_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "eval_folders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eval_generated_turns" ADD CONSTRAINT "eval_generated_turns_runId_fkey" FOREIGN KEY ("runId") REFERENCES "eval_generations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eval_generated_turns" ADD CONSTRAINT "eval_generated_turns_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "eval_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eval_verdicts" ADD CONSTRAINT "eval_verdicts_turnResultId_fkey" FOREIGN KEY ("turnResultId") REFERENCES "eval_generated_turns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "search_eval_queries" ADD CONSTRAINT "search_eval_queries_sheetId_fkey" FOREIGN KEY ("sheetId") REFERENCES "search_eval_sheets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "search_eval_runs" ADD CONSTRAINT "search_eval_runs_sheetId_fkey" FOREIGN KEY ("sheetId") REFERENCES "search_eval_sheets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "search_eval_results" ADD CONSTRAINT "search_eval_results_runId_fkey" FOREIGN KEY ("runId") REFERENCES "search_eval_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "search_eval_results" ADD CONSTRAINT "search_eval_results_queryId_fkey" FOREIGN KEY ("queryId") REFERENCES "search_eval_queries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

