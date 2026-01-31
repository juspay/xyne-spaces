-- CreateTable: Workflow Knowledge (learnings captured during workflow execution)
CREATE TABLE IF NOT EXISTS "workflow_knowledge" (
    "id" TEXT NOT NULL,
    "workflowExecutionId" TEXT NOT NULL,
    "checkpointId" TEXT NOT NULL,
    "learningType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "codeContext" TEXT,
    "filePaths" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_knowledge_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Knowledge Documents (approved learnings as simple docs for AI and users)
CREATE TABLE IF NOT EXISTS "knowledge_documents" (
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
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "knowledge_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: Index for finding knowledge documents by project
CREATE INDEX IF NOT EXISTS "knowledge_documents_projectId_idx" ON "knowledge_documents"("projectId");

-- CreateIndex: Composite index for project + repository queries
CREATE INDEX IF NOT EXISTS "knowledge_documents_projectId_repositoryUrl_idx" ON "knowledge_documents"("projectId", "repositoryUrl");

-- CreateIndex: Index for finding workflow knowledge by execution
CREATE INDEX IF NOT EXISTS "workflow_knowledge_workflowExecutionId_idx" ON "workflow_knowledge"("workflowExecutionId");

-- CreateIndex: Index for finding workflow knowledge by checkpoint
CREATE INDEX IF NOT EXISTS "workflow_knowledge_checkpointId_idx" ON "workflow_knowledge"("checkpointId");
