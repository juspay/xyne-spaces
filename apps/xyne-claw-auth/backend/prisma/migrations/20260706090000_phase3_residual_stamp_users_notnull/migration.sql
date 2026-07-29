-- Phase 3 residual capture.
-- Mirrors the prod manual actions from 2026-07-06 so fresh/other deployments
-- converge before the Slice-B NOT NULL + unique-index flip.

DO $$
DECLARE
  juspay_org_id TEXT;
BEGIN
  SELECT "id" INTO juspay_org_id
  FROM "organizations"
  WHERE "name" = 'Juspay'
  LIMIT 1;

  IF juspay_org_id IS NULL THEN
    RAISE NOTICE 'Skipping residual orgId stamping: organization named Juspay does not exist';
    RETURN;
  END IF;

  UPDATE "pending_memory_reviews"
  SET "orgId" = juspay_org_id
  WHERE "orgId" IS NULL;

  UPDATE "agent_improvement_candidates"
  SET "orgId" = juspay_org_id
  WHERE "orgId" IS NULL;

  UPDATE "pending_batch_reviews"
  SET "orgId" = juspay_org_id
  WHERE "orgId" IS NULL;

  UPDATE "agent_curator_state"
  SET "orgId" = juspay_org_id
  WHERE "orgId" IS NULL;
END $$;

DO $$
DECLARE
  null_count BIGINT;
  is_not_null BOOLEAN;
BEGIN
  SELECT a.attnotnull INTO is_not_null
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = current_schema()
    AND c.relname = 'users'
    AND a.attname = 'orgId'
    AND NOT a.attisdropped;

  IF is_not_null IS TRUE THEN
    RAISE NOTICE 'Skipping users.orgId SET NOT NULL: already NOT NULL';
    RETURN;
  END IF;

  SELECT count(*) INTO null_count
  FROM "users"
  WHERE "orgId" IS NULL;

  IF null_count > 0 THEN
    RAISE EXCEPTION 'Cannot set users.orgId NOT NULL: % users still have NULL orgId. Run scripts/backfill-default-org.ts first, then rerun this migration.', null_count;
  END IF;

  ALTER TABLE "users" ALTER COLUMN "orgId" SET NOT NULL;
END $$;
