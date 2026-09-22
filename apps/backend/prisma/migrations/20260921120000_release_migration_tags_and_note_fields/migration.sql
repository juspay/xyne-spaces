-- Data-only migration: add the `tags` MULTI_SELECT and the `note` STRING to
-- every existing xyne_release_migration_form. New forms get them from
-- XyneFormSchemaProvider (MIGRATION_FIELDS); this backfills forms provisioned
-- before the fields existed. Tag option values mirror MIGRATION_TAGS in
-- packages/shared/src/utils/migrationTags.ts.
-- Idempotent: the NOT EXISTS guards (and @@unique([formId, fieldName])) mean a
-- second run inserts 0 rows.
INSERT INTO "public"."form_fields"
  ("workspaceId", "id", "formId", "fieldName", "fieldType", "fieldEnum", "fieldOptions",
   "isOptional", "sequenceNumber", "createdAt", "updatedAt")
SELECT
  f."workspaceId",
  gen_random_uuid()::text,
  f."id",
  'tags',
  'MULTI_SELECT',
  to_jsonb(tag.values),
  opts."json",
  true,
  COALESCE((SELECT max(ff."sequenceNumber") FROM "public"."form_fields" ff WHERE ff."formId" = f."id"), 0) + 1,
  now(),
  now()
FROM "public"."forms" f
CROSS JOIN (
  SELECT ARRAY['backward-compatible', 'breaking', 'data-backfill', 'downtime',
               'long-running', 'irreversible', 'manual-step',
               'zero-expand', 'zero-contract', 'zero-unsafe']::text[] AS values
) tag
-- Option ids derived from the form id, so they are unique per form (a
-- parentOptionId elsewhere must never resolve into another form) and stable if
-- this ever runs twice.
CROSS JOIN LATERAL (
  SELECT json_agg(json_build_object('id', md5(f."id" || v)::uuid::text, 'value', v))::text AS "json"
  FROM unnest(tag.values) AS v
) opts
WHERE f."entityType" = 'RELEASE_MIGRATION_FORM'
  AND NOT EXISTS (
    SELECT 1 FROM "public"."form_fields" ff
    WHERE ff."formId" = f."id" AND ff."fieldName" = 'tags'
  );

INSERT INTO "public"."form_fields"
  ("workspaceId", "id", "formId", "fieldName", "fieldType", "isOptional", "sequenceNumber",
   "createdAt", "updatedAt")
SELECT
  f."workspaceId",
  gen_random_uuid()::text,
  f."id",
  'note',
  'STRING',
  true,
  COALESCE((SELECT max(ff."sequenceNumber") FROM "public"."form_fields" ff WHERE ff."formId" = f."id"), 0) + 1,
  now(),
  now()
FROM "public"."forms" f
WHERE f."entityType" = 'RELEASE_MIGRATION_FORM'
  AND NOT EXISTS (
    SELECT 1 FROM "public"."form_fields" ff
    WHERE ff."formId" = f."id" AND ff."fieldName" = 'note'
  );
