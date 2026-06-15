---- Prisma model: CanvasVersion
CREATE TABLE "public"."canvas_versions" (
    "id" TEXT NOT NULL,
    "canvasId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "canvas_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "canvas_versions_canvasId_contentHash_key"
ON "public"."canvas_versions"("canvasId", "contentHash");

CREATE INDEX "canvas_versions_canvasId_updatedAt_idx"
ON "public"."canvas_versions"("canvasId", "updatedAt");

CREATE INDEX "canvas_versions_createdBy_idx"
ON "public"."canvas_versions"("createdBy");

