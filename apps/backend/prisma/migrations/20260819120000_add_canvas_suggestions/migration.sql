-- CreateTable
CREATE TABLE "public"."canvas_suggestions" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "canvasId" TEXT NOT NULL,
    "baseBlockIds" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "canvas_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."canvas_suggestion_changes" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "suggestionId" TEXT NOT NULL,
    "op" TEXT NOT NULL,
    "blockId" TEXT,
    "basePos" INTEGER,
    "beforeContent" JSONB,
    "afterContent" JSONB,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "orderIndex" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "canvas_suggestion_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "canvas_suggestions_canvasId_status_createdAt_idx" ON "public"."canvas_suggestions"("canvasId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "canvas_suggestions_createdBy_idx" ON "public"."canvas_suggestions"("createdBy");

-- CreateIndex
CREATE INDEX "canvas_suggestion_changes_suggestionId_orderIndex_idx" ON "public"."canvas_suggestion_changes"("suggestionId", "orderIndex");

-- CreateIndex
CREATE INDEX "canvas_suggestion_changes_blockId_idx" ON "public"."canvas_suggestion_changes"("blockId");

