-- Chat projects: a folder of Xyne AI chats carrying shared instructions.
-- Purely additive — no existing table is altered, so this is safe to apply
-- ahead of the code that reads it.
--
-- chat_project_items is keyed [conversationId, userId] with no agentSlug: a
-- chat can be answered by several agents and its project must follow the chat.
-- The only foreign key is item -> project with ON DELETE CASCADE, so deleting
-- a project drops its membership rows and never touches chat_messages.
--
-- Prisma model: ChatProject
-- Prisma model: ChatProjectItem

-- CreateTable
CREATE TABLE "chat_projects" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "instructions" TEXT NOT NULL DEFAULT '',
    "instructionsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "spacesProjectId" TEXT,
    "defaultAgentSlug" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_project_items" (
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_project_items_pkey" PRIMARY KEY ("conversationId","userId")
);

-- CreateIndex
CREATE INDEX "chat_projects_ownerUserId_sortOrder_idx" ON "chat_projects"("ownerUserId", "sortOrder");

-- CreateIndex
CREATE INDEX "chat_projects_orgId_idx" ON "chat_projects"("orgId");

-- CreateIndex
CREATE INDEX "chat_project_items_projectId_idx" ON "chat_project_items"("projectId");

-- CreateIndex
CREATE INDEX "chat_project_items_userId_idx" ON "chat_project_items"("userId");

-- CreateIndex
CREATE INDEX "chat_project_items_orgId_idx" ON "chat_project_items"("orgId");

-- AddForeignKey
ALTER TABLE "chat_project_items" ADD CONSTRAINT "chat_project_items_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "chat_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
