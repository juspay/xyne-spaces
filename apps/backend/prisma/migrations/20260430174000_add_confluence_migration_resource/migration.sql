INSERT INTO "public"."resources" ("id", "name", "description", "createdAt", "updatedAt")
SELECT
  'confluence-migration-resource',
  'CONFLUENCE-MIGRATION',
  'Admin access to Confluence migration workflows',
  NOW(),
  NOW()
WHERE NOT EXISTS (
  SELECT 1
  FROM "public"."resources"
  WHERE "name" = 'CONFLUENCE-MIGRATION'
);
