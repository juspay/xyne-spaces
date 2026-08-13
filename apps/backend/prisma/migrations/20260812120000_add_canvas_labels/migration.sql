-- CreateTable
CREATE TABLE "canvas_labels" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "canvasId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "canvas_labels_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "canvas_labels_canvasId_name_key" ON "canvas_labels"("canvasId", "name");

-- CreateIndex
CREATE INDEX "canvas_labels_workspaceId_idx" ON "canvas_labels"("workspaceId");

-- CreateIndex
CREATE INDEX "canvas_labels_canvasId_idx" ON "canvas_labels"("canvasId");
