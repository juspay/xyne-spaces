-- Canvas suggestion mode: agent edits to non-empty canvases are parked as
-- per-block pending changes (insert/replace/delete/move) for human review.
-- One table; a batchId groups the rows of one agent proposal session.

-- DropTables (replaces the earlier two-table layout of this same migration;
-- branch was never deployed, so no environment has the old shape)
DROP TABLE IF EXISTS "public"."canvas_suggestion_changes";
DROP TABLE IF EXISTS "public"."canvas_suggestions";

-- CreateTable
CREATE TABLE "public"."canvas_suggestion_changes" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "canvasId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "op" TEXT NOT NULL,
    "blockId" TEXT,
    "proposedAnchorId" TEXT,
    "currentAnchorId" TEXT,
    "orderIndex" INTEGER NOT NULL,
    "beforeContent" JSONB,
    "afterContent" JSONB,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "canvas_suggestion_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "canvas_suggestion_changes_canvasId_status_idx" ON "public"."canvas_suggestion_changes"("canvasId", "status");

-- CreateIndex
CREATE INDEX "canvas_suggestion_changes_batchId_idx" ON "public"."canvas_suggestion_changes"("batchId");
