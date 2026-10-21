-- CreateTable
CREATE TABLE "public"."connect_group" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "hostWorkspaceId" TEXT NOT NULL,
    "invitedEntityId" TEXT,
    "invitedWorkspaceId" TEXT,
    "connectId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connect_group_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- The (connectId, invitedWorkspaceId) unique below also serves every `connectId = ?` probe
-- via its leftmost prefix, so no standalone connectId index is created. entityId / hostWorkspaceId
-- indexes are intentionally omitted — nothing queries connect_group by them in Phase 1.
CREATE UNIQUE INDEX "connect_group_connectId_invitedWorkspaceId_key" ON "public"."connect_group"("connectId", "invitedWorkspaceId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "connect_group_hostWorkspaceId_idx" ON "public"."connect_group"("hostWorkspaceId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "connect_group_invitedWorkspaceId_idx" ON "public"."connect_group"("invitedWorkspaceId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "connect_group_entityId_idx" ON "public"."connect_group"("entityId");
