-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agents" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "systemPrompt" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'global',
    "ownerUserId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "color" TEXT NOT NULL DEFAULT '#6366f1',
    "modelId" TEXT NOT NULL DEFAULT '',
    "config" JSONB NOT NULL DEFAULT '{}',
    "spacesAppId" TEXT,
    "spacesAppUserId" TEXT,
    "spacesAppToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mcp_servers_pkey" PRIMARY KEY ("id")
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
CREATE TABLE "scheduled_jobs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "agentSlug" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "context" TEXT,
    "channelId" TEXT,
    "conversationId" TEXT,
    "type" TEXT NOT NULL,
    "delayMs" BIGINT,
    "cronExpression" TEXT,
    "bullJobId" TEXT,
    "bullSchedulerId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "maxRuns" INTEGER,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "agents_slug_key" ON "agents"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "agents_spacesAppId_key" ON "agents"("spacesAppId");

-- CreateIndex
CREATE UNIQUE INDEX "tools_slug_key" ON "tools"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "agent_tools_agentId_toolId_key" ON "agent_tools"("agentId", "toolId");

-- CreateIndex
CREATE UNIQUE INDEX "gateways_type_key" ON "gateways"("type");

-- CreateIndex
CREATE UNIQUE INDEX "gateway_identities_gatewayId_externalUserId_key" ON "gateway_identities"("gatewayId", "externalUserId");

-- CreateIndex
CREATE UNIQUE INDEX "mcp_servers_type_key" ON "mcp_servers"("type");

-- CreateIndex
CREATE UNIQUE INDEX "user_mcp_connections_userId_mcpServerId_key" ON "user_mcp_connections"("userId", "mcpServerId");

-- CreateIndex
CREATE UNIQUE INDEX "scheduled_jobs_bullSchedulerId_key" ON "scheduled_jobs"("bullSchedulerId");

-- CreateIndex
CREATE INDEX "scheduled_jobs_userId_idx" ON "scheduled_jobs"("userId");

-- CreateIndex
CREATE INDEX "scheduled_jobs_status_idx" ON "scheduled_jobs"("status");

-- AddForeignKey
ALTER TABLE "agents" ADD CONSTRAINT "agents_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_tools" ADD CONSTRAINT "agent_tools_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_tools" ADD CONSTRAINT "agent_tools_toolId_fkey" FOREIGN KEY ("toolId") REFERENCES "tools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gateway_identities" ADD CONSTRAINT "gateway_identities_gatewayId_fkey" FOREIGN KEY ("gatewayId") REFERENCES "gateways"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gateway_identities" ADD CONSTRAINT "gateway_identities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_mcp_connections" ADD CONSTRAINT "user_mcp_connections_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_mcp_connections" ADD CONSTRAINT "user_mcp_connections_mcpServerId_fkey" FOREIGN KEY ("mcpServerId") REFERENCES "mcp_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
