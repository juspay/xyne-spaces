-- CreateTable
CREATE TABLE "chat_project_knowledge" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "addedByUserId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "storagePath" TEXT,
    "mimeType" TEXT,
    "size" INTEGER,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_project_knowledge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chat_project_knowledge_projectId_createdAt_idx" ON "chat_project_knowledge"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "chat_project_knowledge_orgId_idx" ON "chat_project_knowledge"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "chat_project_knowledge_projectId_type_refId_key" ON "chat_project_knowledge"("projectId", "type", "refId");

-- AddForeignKey
ALTER TABLE "chat_project_knowledge" ADD CONSTRAINT "chat_project_knowledge_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "chat_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

