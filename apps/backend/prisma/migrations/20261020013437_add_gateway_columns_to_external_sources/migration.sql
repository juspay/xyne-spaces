-- AlterTable
ALTER TABLE "workflow"."external_sources" ADD COLUMN     "createdBy" TEXT,
ADD COLUMN     "kind" TEXT,
ADD COLUMN     "parentId" TEXT,
ADD COLUMN     "spacesId" TEXT,
ADD COLUMN     "statusReason" TEXT;

-- CreateIndex
CREATE INDEX "external_sources_parentId_idx" ON "workflow"."external_sources"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "external_sources_spacesId_sourceType_key" ON "workflow"."external_sources"("spacesId", "sourceType");

