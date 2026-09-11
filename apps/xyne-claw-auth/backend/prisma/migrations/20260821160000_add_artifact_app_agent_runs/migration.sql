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

-- AddForeignKey
ALTER TABLE "artifact_app_agent_runs" ADD CONSTRAINT "artifact_app_agent_runs_appId_fkey" FOREIGN KEY ("appId") REFERENCES "artifact_apps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

