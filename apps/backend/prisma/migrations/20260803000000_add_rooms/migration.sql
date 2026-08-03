-- Prisma models: Room ("rooms"), RoomSource ("room_sources"),
-- RoomMember ("room_members") and RoomRecap ("room_recaps").
-- Private rooms that track a topic across a project's channels: a room owns its
-- source channels, its membership (owner-approved), and the recaps the curation
-- agent generates for it.

-- CreateTable
CREATE TABLE "public"."rooms" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "clawAgentId" TEXT,
    "status" TEXT NOT NULL,
    "curationCadence" TEXT NOT NULL,
    "lastCuratedAt" TIMESTAMP(3),
    "checklistTemplate" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."room_sources" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "addedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "room_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."room_members" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "room_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."room_recaps" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "type" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "citations" JSONB,
    "status" TEXT NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "room_recaps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rooms_projectId_idx" ON "public"."rooms"("projectId");

-- CreateIndex
CREATE INDEX "rooms_status_curationCadence_lastCuratedAt_idx" ON "public"."rooms"("status", "curationCadence", "lastCuratedAt");

-- CreateIndex
CREATE UNIQUE INDEX "room_sources_roomId_sourceType_sourceId_key" ON "public"."room_sources"("roomId", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "room_members_userId_status_idx" ON "public"."room_members"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "room_members_roomId_userId_key" ON "public"."room_members"("roomId", "userId");

-- CreateIndex
CREATE INDEX "room_recaps_roomId_type_status_createdAt_idx" ON "public"."room_recaps"("roomId", "type", "status", "createdAt" DESC);
