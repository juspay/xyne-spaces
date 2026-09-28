-- Data-only: add the optional `tags` and `note` fields to release migration
-- forms provisioned before those fields existed. Forms created from here on get
-- them from XyneFormSchemaProvider.MIGRATION_FIELDS.
-- The tag vocabulary lives in packages/shared/src/utils/migrationTags.ts and is
-- rendered by the release UI, so no fieldOptions are stored here.
-- Idempotent: the NOT EXISTS guard (and @@unique([formId, fieldName])) means a
-- second run inserts nothing.
INSERT INTO "public"."form_fields"
  ("workspaceId", "id", "formId", "fieldName", "fieldType", "isOptional",
   "sequenceNumber", "createdAt", "updatedAt")
SELECT
  f."workspaceId",
  gen_random_uuid()::text,
  f."id",
  new_field."name",
  new_field."type",
  true,
  COALESCE((SELECT max(ff."sequenceNumber") FROM "public"."form_fields" ff WHERE ff."formId" = f."id"), 0)
    + new_field."offset",
  now(),
  now()
FROM "public"."forms" f
CROSS JOIN (VALUES ('tags', 'MULTI_SELECT', 1), ('note', 'STRING', 2)) AS new_field("name", "type", "offset")
WHERE f."entityType" = 'RELEASE_MIGRATION_FORM'
  AND NOT EXISTS (
    SELECT 1 FROM "public"."form_fields" ff
    WHERE ff."formId" = f."id" AND ff."fieldName" = new_field."name"
  );
