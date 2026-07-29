-- CreateEnum
CREATE TYPE "CanvasVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

-- CreateEnum
CREATE TYPE "CanvasRole" AS ENUM ('OWNER', 'EDITOR', 'VIEWER');

-- CreateTable
CREATE TABLE "canvases" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "channelId" TEXT,
    "createdBy" TEXT NOT NULL,
    "viewAccessId" TEXT,
    "editAccessId" TEXT,
    "visibility" "CanvasVisibility" NOT NULL DEFAULT 'PRIVATE',
    "isTemplate" BOOLEAN NOT NULL DEFAULT false,
    "lastEditedBy" TEXT,
    "lastEditedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,

    CONSTRAINT "canvases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canvas_participants" (
    "id" TEXT NOT NULL,
    "canvasId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "CanvasRole" NOT NULL DEFAULT 'VIEWER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "canvas_participants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "canvases_viewAccessId_key" ON "canvases"("viewAccessId");

-- CreateIndex
CREATE UNIQUE INDEX "canvases_editAccessId_key" ON "canvases"("editAccessId");

-- CreateIndex
CREATE INDEX "canvases_createdBy_idx" ON "canvases"("createdBy");

-- CreateIndex
CREATE INDEX "canvases_channelId_idx" ON "canvases"("channelId");

-- CreateIndex
CREATE INDEX "canvases_visibility_idx" ON "canvases"("visibility");

-- CreateIndex
CREATE INDEX "canvases_isTemplate_idx" ON "canvases"("isTemplate");

-- CreateIndex
CREATE INDEX "canvases_viewAccessId_idx" ON "canvases"("viewAccessId");

-- CreateIndex
CREATE INDEX "canvases_editAccessId_idx" ON "canvases"("editAccessId");

-- CreateIndex
CREATE INDEX "canvas_participants_canvasId_idx" ON "canvas_participants"("canvasId");

-- CreateIndex
CREATE INDEX "canvas_participants_userId_idx" ON "canvas_participants"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "canvas_participants_canvasId_userId_key" ON "canvas_participants"("canvasId", "userId");

