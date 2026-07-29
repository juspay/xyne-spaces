-- Prisma model: CanvasFolder
-- CreateTable
CREATE TABLE "public"."canvas_folders" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "channelId" TEXT,
    "name" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "canvas_folders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "canvas_folders_projectId_idx" ON "public"."canvas_folders"("projectId");

-- CreateIndex
CREATE INDEX "canvas_folders_channelId_idx" ON "public"."canvas_folders"("channelId");

-- CreateIndex
CREATE INDEX "canvas_folders_createdBy_idx" ON "public"."canvas_folders"("createdBy");

-- CreateIndex
CREATE UNIQUE INDEX "canvas_folders_projectId_channelId_name_key" ON "public"."canvas_folders"("projectId", "channelId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "canvas_folders_projectId_name_project_scope_key" ON "public"."canvas_folders"("projectId", "name") WHERE "projectId" IS NOT NULL AND "channelId" IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX "canvas_folders_createdBy_name_personal_scope_key" ON "public"."canvas_folders"("createdBy", "name") WHERE "projectId" IS NULL AND "channelId" IS NULL;

-- CreateIndex
CREATE INDEX "canvas_folders_projectId_channelId_idx" ON "public"."canvas_folders"("projectId", "channelId");

-- AddColumn
ALTER TABLE "public"."canvases" ADD COLUMN "folderId" TEXT;

-- AddColumn
ALTER TABLE "public"."canvases" ADD COLUMN "projectId" TEXT;

-- CreateIndex
CREATE INDEX "canvases_folderId_idx" ON "public"."canvases"("folderId");

-- CreateIndex
CREATE INDEX "canvases_projectId_idx" ON "public"."canvases"("projectId");
