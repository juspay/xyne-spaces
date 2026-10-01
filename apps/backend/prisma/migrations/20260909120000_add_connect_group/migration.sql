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
CREATE INDEX "connect_group_connectId_idx" ON "public"."connect_group"("connectId");

-- CreateIndex
CREATE INDEX "connect_group_entityId_idx" ON "public"."connect_group"("entityId");

-- CreateIndex
CREATE UNIQUE INDEX "connect_group_connectId_invitedWorkspaceId_key" ON "public"."connect_group"("connectId", "invitedWorkspaceId");
