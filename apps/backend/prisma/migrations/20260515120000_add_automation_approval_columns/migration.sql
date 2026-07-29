-- AlterTable
ALTER TABLE "public"."workflows" ADD COLUMN     "automationSeriesId" TEXT;

-- CreateIndex
CREATE INDEX "workflows_automationSeriesId_idx" ON "public"."workflows"("automationSeriesId");

-- Backfill: every existing automation row becomes its own one-row lineage so
-- the new approval flow can treat it as the canonical LIVE version. the following is not supposed to run in prod only in sbx 
-- since there are less than 10 entries in sbx and none in prod


-- UPDATE "public"."workflows"
--    SET "automationSeriesId" = "id"
--  WHERE "workflowType" = 'Automations'
--    AND "automationSeriesId" IS NULL;

