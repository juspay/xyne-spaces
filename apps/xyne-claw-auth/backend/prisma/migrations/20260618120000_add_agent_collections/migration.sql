-- CreateTable
-- Per-agent Knowledge Base grant. References a Collection (and optionally a
-- specific file) in the spaces backend. No foreign key — collections live in
-- the spaces postgres, not claw-auth's. fileId IS NULL = whole collection;
-- fileId IS NOT NULL = single-file grant. See models/Agent.collections.
CREATE TABLE "agent_collections" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "fileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_collections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_collections_agentId_collectionId_fileId_key" ON "agent_collections"("agentId", "collectionId", "fileId");

-- CreateIndex
CREATE INDEX "agent_collections_agentId_idx" ON "agent_collections"("agentId");

-- AddForeignKey
ALTER TABLE "agent_collections" ADD CONSTRAINT "agent_collections_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
