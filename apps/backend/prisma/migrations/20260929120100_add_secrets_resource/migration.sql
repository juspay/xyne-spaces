INSERT INTO "public"."resources" ("id", "name", "description", "createdAt", "updatedAt")
SELECT
  'secrets-resource',
  'SECRETS',
  'Secrets vault admin UI (/api/secrets-vault/*, /secrets).',
  NOW(),
  NOW()
WHERE NOT EXISTS (
  SELECT 1
  FROM "public"."resources"
  WHERE "name" = 'SECRETS'
);
