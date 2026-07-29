INSERT INTO "public"."resources" ("id", "name", "description", "createdAt", "updatedAt")
SELECT
  'automations-resource',
  'AUTOMATIONS',
  'Admin access to manage workspace automations (approve/revoke proposals, view runs)',
  NOW(),
  NOW()
WHERE NOT EXISTS (
  SELECT 1
  FROM "public"."resources"
  WHERE "name" = 'AUTOMATIONS'
);
