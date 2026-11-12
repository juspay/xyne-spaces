-- CreateTable
CREATE TABLE "non_zero"."claw_agent_principals" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "clawAgentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "botUserId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "claw_agent_principals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "non_zero"."claw_agent_grants" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "principalId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "onBehalfOfUserId" TEXT,
    "grantedBy" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'APPROVED',
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "claw_agent_grants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "claw_agent_principals_botUserId_key" ON "non_zero"."claw_agent_principals"("botUserId");

-- CreateIndex
CREATE INDEX "claw_agent_principals_workspaceId_idx" ON "non_zero"."claw_agent_principals"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "claw_agent_principals_clawAgentId_workspaceId_key" ON "non_zero"."claw_agent_principals"("clawAgentId", "workspaceId");

-- CreateIndex
CREATE INDEX "claw_agent_grants_principalId_status_idx" ON "non_zero"."claw_agent_grants"("principalId", "status");

-- CreateIndex
CREATE INDEX "claw_agent_grants_onBehalfOfUserId_idx" ON "non_zero"."claw_agent_grants"("onBehalfOfUserId");

