INSERT INTO "public"."resources" ("id", "name", "description", "createdAt", "updatedAt")
SELECT
  'ticket-migration-resource',
  'TICKET-MIGRATION',
  'Admin access to Jira and ticket migration workflows',
  NOW(),
  NOW()
WHERE NOT EXISTS (
  SELECT 1
  FROM "public"."resources"
  WHERE "name" = 'TICKET-MIGRATION'
);
