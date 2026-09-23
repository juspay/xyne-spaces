-- Tenant keys for the artifact/surface tables: add orgId where it was missing
-- and make ConversationArtifact.orgId required, so every row is scopeable.
--
-- Manual-apply safe: columns are added nullable, backfilled from the row's own
-- parent, and only then set NOT NULL behind a guard that refuses to flip while
-- any row is still unscoped.

ALTER TABLE "artifact_comments" ADD COLUMN IF NOT EXISTS "orgId" TEXT;
ALTER TABLE "surface_calls" ADD COLUMN IF NOT EXISTS "orgId" TEXT;

UPDATE "artifact_comments" c
SET "orgId" = a."orgId"
FROM "conversation_artifacts" a
WHERE c."artifactId" = a."id" AND c."orgId" IS NULL AND a."orgId" IS NOT NULL;

UPDATE "surface_calls" s
SET "orgId" = d."orgId"
FROM "local_harness_devices" d
WHERE s."deviceId" = d."id" AND s."orgId" IS NULL;

UPDATE "conversation_artifacts" a
SET "orgId" = r."orgId"
FROM "agent_runs" r
WHERE a."runId" = r."id" AND a."orgId" IS NULL;

UPDATE "conversation_artifacts" a
SET "orgId" = u."orgId"
FROM "users" u
WHERE a."createdByUserId" = u."id" AND a."orgId" IS NULL;

UPDATE "artifact_comments" c
SET "orgId" = u."orgId"
FROM "users" u
WHERE c."userId" = u."id" AND c."orgId" IS NULL;

DO $$
DECLARE
  target TEXT;
  null_count BIGINT;
BEGIN
  FOREACH target IN ARRAY ARRAY['conversation_artifacts', 'artifact_comments', 'surface_calls']
  LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE "orgId" IS NULL', target) INTO null_count;
    IF null_count > 0 THEN
      RAISE EXCEPTION 'Cannot set %.orgId NOT NULL: % rows still have NULL orgId. Backfill them from their parent row, then rerun this migration.', target, null_count;
    END IF;
    EXECUTE format('ALTER TABLE %I ALTER COLUMN "orgId" SET NOT NULL', target);
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS "artifact_comments_orgId_idx" ON "artifact_comments"("orgId");
CREATE INDEX IF NOT EXISTS "surface_calls_orgId_idx" ON "surface_calls"("orgId");
