-- Add org_id to all Team Intelligence V2 tables for multi-org scoping.
-- The old Prisma schema had workspaceId defined but it was never applied in a migration,
-- so the actual DB columns do not exist and only org_id needs to be added here.

ALTER TABLE "non_zero"."team_intelligence_ingestion_batches_v2"
  ADD COLUMN IF NOT EXISTS "orgId" TEXT;

ALTER TABLE "non_zero"."team_intelligence_user_ingestions_v2"
  ADD COLUMN IF NOT EXISTS "orgId" TEXT;

ALTER TABLE "non_zero"."team_intelligence_team_summaries_v2"
  ADD COLUMN IF NOT EXISTS "orgId" TEXT;

ALTER TABLE "non_zero"."team_intelligence_org_summaries_v2"
  ADD COLUMN IF NOT EXISTS "orgId" TEXT;

CREATE INDEX IF NOT EXISTS "team_intelligence_ingestion_batches_v2_orgId_idx"
  ON "non_zero"."team_intelligence_ingestion_batches_v2"("orgId");

CREATE INDEX IF NOT EXISTS "team_intelligence_user_ingestions_v2_orgId_idx"
  ON "non_zero"."team_intelligence_user_ingestions_v2"("orgId");

CREATE INDEX IF NOT EXISTS "team_intelligence_team_summaries_v2_orgId_idx"
  ON "non_zero"."team_intelligence_team_summaries_v2"("orgId");

CREATE INDEX IF NOT EXISTS "team_intelligence_org_summaries_v2_orgId_idx"
  ON "non_zero"."team_intelligence_org_summaries_v2"("orgId");
