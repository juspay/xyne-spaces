-- CreateEnum
CREATE TYPE "public"."NudgeKind" AS ENUM ('CREATE_TICKET_FROM_MESSAGE', 'FIND_RELATED_TICKET_FROM_MESSAGE', 'FIND_RELATED_MESSAGE_FROM_MESSAGE', 'LINK_PASTE_TO_SURFACE', 'FORWARD_MESSAGE_LINK', 'DELETE_MESSAGE_CLEANUP');

-- CreateEnum
CREATE TYPE "public"."NudgeState" AS ENUM ('ACTIVE', 'DISMISSED', 'ACTED_ON');

-- CreateEnum
CREATE TYPE "public"."SurfaceAreaType" AS ENUM ('MESSAGE', 'TICKET', 'CANVAS', 'CALL', 'CONVERSATION');

-- CreateEnum
CREATE TYPE "public"."SurfaceLinkKind" AS ENUM ('RELATES_TO');

-- CreateTable
CREATE TABLE "public"."surface_nudges" (
    "id" TEXT NOT NULL,
    "nudgeKind" "public"."NudgeKind" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priority" TEXT DEFAULT 'medium',
    "actions" JSONB,
    "state" "public"."NudgeState" NOT NULL DEFAULT 'ACTIVE',
    "visibleTo" TEXT,
    "projectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "surface_nudges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."surface_links" (
    "id" TEXT NOT NULL,
    "sourceType" "public"."SurfaceAreaType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "targetType" "public"."SurfaceAreaType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "linkKind" "public"."SurfaceLinkKind" NOT NULL,
    "createdBy" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "surface_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "surface_nudges_sourceId_state_idx" ON "public"."surface_nudges"("sourceId", "state");

-- CreateIndex
CREATE INDEX "surface_nudges_projectId_state_idx" ON "public"."surface_nudges"("projectId", "state");

-- CreateIndex
CREATE INDEX "surface_nudges_createdAt_idx" ON "public"."surface_nudges"("createdAt");

-- CreateIndex
CREATE INDEX "surface_links_sourceType_sourceId_idx" ON "public"."surface_links"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "surface_links_targetType_targetId_idx" ON "public"."surface_links"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "surface_links_projectId_idx" ON "public"."surface_links"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "surface_links_sourceType_sourceId_targetType_targetId_linkK_key" ON "public"."surface_links"("sourceType", "sourceId", "targetType", "targetId", "linkKind");
