-- Phase 2 (slice 1): org-scope the primary agent entities. ADDITIVE ONLY.
-- `orgId` is added NULLABLE and the slug/name unique indexes are LEFT UNCHANGED
-- (`agents.slug`, `skills.slug`, `subagent_definitions.name` stay globally
-- @unique). A later migration flips these columns to NOT NULL and swaps the
-- unique indexes to composite ([orgId, slug]) — only AFTER the phase-2 backfill
-- has populated every orgId, so no null-org row can violate the composite.

-- AlterTable
ALTER TABLE "agents" ADD COLUMN     "orgId" TEXT;

-- AlterTable
ALTER TABLE "skills" ADD COLUMN     "orgId" TEXT;

-- AlterTable
ALTER TABLE "subagent_definitions" ADD COLUMN     "orgId" TEXT;

-- CreateIndex
CREATE INDEX "agents_orgId_idx" ON "agents"("orgId");

-- CreateIndex
CREATE INDEX "skills_orgId_idx" ON "skills"("orgId");

-- CreateIndex
CREATE INDEX "subagent_definitions_orgId_idx" ON "subagent_definitions"("orgId");

-- AddForeignKey
ALTER TABLE "agents" ADD CONSTRAINT "agents_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skills" ADD CONSTRAINT "skills_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subagent_definitions" ADD CONSTRAINT "subagent_definitions_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
