-- Grants installs created before 2026-06-12 the scopes their app declares, as install-time
-- copyFromApp would have, so the legacy-app bypass in requirePermission can be removed.
-- Only installs with no grant rows at all are touched: any row means the install has already
-- been through the permission flow and its rows (including revokes) are authoritative.
INSERT INTO "public"."installed_app_permissions"
("id", "installedAppId", "permissionId", "status", "workspaceId", "createdAt")
SELECT gen_random_uuid()::text, ia."id", ap."permissionId", 'APPROVED', ia."workspaceId", NOW()
FROM "public"."installed_apps" ia
JOIN "public"."app_permission" ap ON ap."appId" = ia."appId"
WHERE ia."createdAt" < TIMESTAMP '2026-06-12 00:00:00'
  AND NOT EXISTS (
    SELECT 1 FROM "public"."installed_app_permissions" iap
    WHERE iap."installedAppId" = ia."id"
  )
ON CONFLICT ("installedAppId", "permissionId") DO NOTHING;
