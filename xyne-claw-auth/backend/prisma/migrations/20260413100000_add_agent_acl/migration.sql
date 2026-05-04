-- Add promotedBy/promotedAt to agents (skip if already exists)
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "promotedBy" TEXT;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "promotedAt" TIMESTAMP(3);

-- User roles (CLAW_ADMIN etc.)
CREATE TABLE "user_roles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "grantedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "user_roles_userId_role_key" ON "user_roles"("userId", "role");
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Agent shares
CREATE TABLE "agent_shares" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'VIEWER',
    "sharedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agent_shares_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "agent_shares_agentId_userId_key" ON "agent_shares"("agentId", "userId");
ALTER TABLE "agent_shares" ADD CONSTRAINT "agent_shares_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_shares" ADD CONSTRAINT "agent_shares_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Audit event enum
CREATE TYPE "AgentAuditEvent" AS ENUM ('AGENT_PROMOTED', 'AGENT_DEMOTED', 'AGENT_SHARED', 'AGENT_UNSHARED', 'ROLE_GRANTED', 'ROLE_REVOKED', 'AGENT_CREATED', 'AGENT_DELETED');

-- Audit log
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
