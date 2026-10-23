-- AlterTable
ALTER TABLE "workflow"."external_sources" ADD COLUMN     "createdBy" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "recordParentId" TEXT,
ADD COLUMN     "recordStateReason" TEXT,
ADD COLUMN     "recordType" TEXT,
ADD COLUMN     "spacesIdentifier" TEXT;

-- CreateIndex
CREATE INDEX "external_sources_workspaceId_spacesIdentifier_idx" ON "workflow"."external_sources"("workspaceId", "spacesIdentifier");

