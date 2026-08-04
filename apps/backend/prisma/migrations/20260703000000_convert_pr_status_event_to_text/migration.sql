-- Convert the PR status mapping column from the frozen PostgreSQL enum to TEXT.
-- PRStatusEvent remains an application-level enum in @xyne/shared.
ALTER TABLE "public"."stage_pr_status_mappings"
ALTER COLUMN "prStatus" TYPE TEXT
USING "prStatus"::TEXT;
