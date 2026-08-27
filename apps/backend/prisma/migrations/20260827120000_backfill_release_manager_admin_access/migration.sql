-- Seed RELEASE-MANAGER resource
INSERT INTO "public"."resources" ("id", "name", "description", "createdAt", "updatedAt")
SELECT
  'release-manager-resource',
  'RELEASE-MANAGER',
  'Release Manager tab and repository commit-analysis endpoints (/api/commits/analyze/*)',
  NOW(),
  NOW()
WHERE NOT EXISTS (
  SELECT 1
  FROM "public"."resources"
  WHERE "name" = 'RELEASE-MANAGER'
);

-- Backfill: grant RELEASE-MANAGER ADMIN to existing ADMIN/OWNER users
INSERT INTO "public"."resource_access" ("id", "workspaceId", "userId", "resourceId", "accessType", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  "u"."workspaceId",
  "u"."id",
  "r"."id",
  'ADMIN',
  NOW(),
  NOW()
FROM "public"."users" "u"
CROSS JOIN "public"."resources" "r"
WHERE "u"."role" IN ('ADMIN', 'OWNER')
  AND "u"."leftAt" IS NULL
  AND "r"."name" = 'RELEASE-MANAGER'
ON CONFLICT ("userId", "resourceId", "accessType") DO NOTHING;
