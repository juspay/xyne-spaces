-- Session-scoped apps: a conversation owns exactly ONE app, and every later
-- generation in that thread becomes a new version of it rather than a sibling.
--
-- Before this, `create-app` had no update path, so a thread that iterated five
-- times produced five unrelated apps (observed locally: five copies of "Univer
-- Spreadsheet"). The unique index below IS the one-app-per-session rule —
-- enforced by the database so two concurrent generations cannot both insert.
-- Nullable because apps saved before this, and any app created outside a
-- conversation, have none; Postgres permits many NULLs under a unique index.
ALTER TABLE "artifact_apps" ADD COLUMN "conversationId" TEXT;

-- The version the owner and the agent currently see. Distinct from
-- publishedVersionId, which is what everyone else sees. A pointer, not a copy:
-- @@unique([appId, contentHash]) makes re-inserting an old version impossible,
-- so "restore" has to mean "move this pointer".
ALTER TABLE "artifact_apps" ADD COLUMN "headVersionId" TEXT;

CREATE UNIQUE INDEX "artifact_apps_conversationId_key" ON "artifact_apps"("conversationId");

-- Backfill head to each app's newest version so existing apps behave as if they
-- had always tracked one.
UPDATE "artifact_apps" a
SET "headVersionId" = (
  SELECT v."id"
  FROM "artifact_app_versions" v
  WHERE v."appId" = a."id"
  ORDER BY v."versionNumber" DESC
  LIMIT 1
)
WHERE a."headVersionId" IS NULL;
