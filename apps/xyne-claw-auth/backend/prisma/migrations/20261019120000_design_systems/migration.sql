-- CreateTable
CREATE TABLE "design_systems" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "designMd" TEXT NOT NULL DEFAULT '',
    "tokensCss" TEXT NOT NULL DEFAULT '',
    "assets" JSONB,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "sourceUrl" TEXT,
    "sourceRepo" TEXT,
    "sourceCommit" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "design_systems_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_conversation_design_systems" (
    "conversationId" TEXT NOT NULL,
    "designSystemId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "setByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_conversation_design_systems_pkey" PRIMARY KEY ("conversationId")
);

-- CreateIndex
CREATE INDEX "design_systems_orgId_idx" ON "design_systems"("orgId");

-- CreateIndex
CREATE INDEX "design_systems_orgId_name_idx" ON "design_systems"("orgId", "name");

-- CreateIndex
CREATE INDEX "chat_conversation_design_systems_designSystemId_idx" ON "chat_conversation_design_systems"("designSystemId");

-- CreateIndex
CREATE INDEX "chat_conversation_design_systems_orgId_idx" ON "chat_conversation_design_systems"("orgId");

-- AddForeignKey
ALTER TABLE "chat_conversation_design_systems" ADD CONSTRAINT "chat_conversation_design_systems_designSystemId_fkey" FOREIGN KEY ("designSystemId") REFERENCES "design_systems"("id") ON DELETE CASCADE ON UPDATE CASCADE;
