-- AlterTable
ALTER TABLE "workflow"."external_sources" ADD COLUMN     "externalIdentifier" TEXT;

-- CreateIndex
CREATE INDEX "external_sources_displayName_idx" ON "workflow"."external_sources"("displayName");

-- CreateIndex
CREATE INDEX "external_sources_externalIdentifier_idx" ON "workflow"."external_sources"("externalIdentifier");
