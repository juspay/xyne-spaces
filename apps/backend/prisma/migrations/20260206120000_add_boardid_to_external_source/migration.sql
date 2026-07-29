-- AlterTable: Add boardId column to external_sources for per-source board routing
ALTER TABLE "external_sources" ADD COLUMN IF NOT EXISTS "boardId" TEXT;

-- CreateIndex: Index for efficient boardId lookups
CREATE INDEX IF NOT EXISTS "external_sources_boardId_idx" ON "external_sources"("boardId");
