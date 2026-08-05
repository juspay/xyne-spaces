-- Register chat:delete as an app permission scope.
INSERT INTO "public"."available_app_permissions" ("id", "name", "type", "description", "createdAt")
VALUES (gen_random_uuid()::text, 'chat', 'DELETE', 'Delete chat messages the app posted, from apps', NOW())
ON CONFLICT ("name", "type") DO UPDATE
SET "description" = EXCLUDED."description";
