CREATE TABLE "agent_requests" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "agentSlug" TEXT NOT NULL,
    "requestType" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reviewerId" TEXT,
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agent_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "agent_requests_status_idx" ON "agent_requests"("status");
CREATE INDEX "agent_requests_requesterId_idx" ON "agent_requests"("requesterId");

-- Add new audit event types
ALTER TYPE "AgentAuditEvent" ADD VALUE IF NOT EXISTS 'REQUEST_CREATED';
ALTER TYPE "AgentAuditEvent" ADD VALUE IF NOT EXISTS 'REQUEST_APPROVED';
ALTER TYPE "AgentAuditEvent" ADD VALUE IF NOT EXISTS 'REQUEST_REJECTED';
