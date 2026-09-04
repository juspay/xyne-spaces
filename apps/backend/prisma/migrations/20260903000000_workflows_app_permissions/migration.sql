-- Registers the workflows app permissions in every environment.
--
-- `scripts/seed-app-permissions.ts` holds the canonical scope list, but it only runs from
-- setup.sh and start-services.sh — both local, both on .env.local. Nothing runs it on
-- deploy, so the rows have to arrive as a migration. Keep the two in sync: a scope added
-- to that script needs a migration like this one to reach a deployed environment.
--
-- `type` is plain text rather than the AppPermissionType enum, which
-- 20260804120002_enums_to_text_batch2 converted the column to and then dropped.
INSERT INTO "public"."available_app_permissions" ("id", "name", "type", "description", "createdAt")
SELECT
  'workflows-read-permission',
  'workflows',
  'READ',
  'Read workflows, folders and execution history from apps',
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "public"."available_app_permissions"
  WHERE "name" = 'workflows' AND "type" = 'READ'
);

INSERT INTO "public"."available_app_permissions" ("id", "name", "type", "description", "createdAt")
SELECT
  'workflows-write-permission',
  'workflows',
  'WRITE',
  'Create, update and trigger workflows from apps',
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "public"."available_app_permissions"
  WHERE "name" = 'workflows' AND "type" = 'WRITE'
);
