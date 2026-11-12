-- Scopes for Claw agents acting on behalf of a user (src/claw/routeScopes.ts).

-- Kept in sync with scripts/seed-app-permissions.ts; idempotent so a seeded environment is fine.

INSERT INTO "public"."available_app_permissions" ("id", "name", "type", "description", "createdAt")
SELECT 'automations-read-permission', 'automations', 'READ', 'Read automations, runs, versions and schema', NOW()
WHERE NOT EXISTS (SELECT 1 FROM "public"."available_app_permissions" WHERE "name" = 'automations' AND "type" = 'READ');

INSERT INTO "public"."available_app_permissions" ("id", "name", "type", "description", "createdAt")
SELECT 'automations-write-permission', 'automations', 'WRITE', 'Create, update, submit and delete automations', NOW()
WHERE NOT EXISTS (SELECT 1 FROM "public"."available_app_permissions" WHERE "name" = 'automations' AND "type" = 'WRITE');

INSERT INTO "public"."available_app_permissions" ("id", "name", "type", "description", "createdAt")
SELECT 'canvas-write-permission', 'canvas', 'WRITE', 'Create canvases', NOW()
WHERE NOT EXISTS (SELECT 1 FROM "public"."available_app_permissions" WHERE "name" = 'canvas' AND "type" = 'WRITE');

INSERT INTO "public"."available_app_permissions" ("id", "name", "type", "description", "createdAt")
SELECT 'email-write-permission', 'email', 'WRITE', 'Send email replies on ticket conversations', NOW()
WHERE NOT EXISTS (SELECT 1 FROM "public"."available_app_permissions" WHERE "name" = 'email' AND "type" = 'WRITE');

INSERT INTO "public"."available_app_permissions" ("id", "name", "type", "description", "createdAt")
SELECT 'kb-read-permission', 'kb', 'READ', 'List and read knowledge-base collections the user can access', NOW()
WHERE NOT EXISTS (SELECT 1 FROM "public"."available_app_permissions" WHERE "name" = 'kb' AND "type" = 'READ');

INSERT INTO "public"."available_app_permissions" ("id", "name", "type", "description", "createdAt")
SELECT 'kb-write-permission', 'kb', 'WRITE', 'Upload files to knowledge-base collections', NOW()
WHERE NOT EXISTS (SELECT 1 FROM "public"."available_app_permissions" WHERE "name" = 'kb' AND "type" = 'WRITE');

INSERT INTO "public"."available_app_permissions" ("id", "name", "type", "description", "createdAt")
SELECT 'sdlc-read-permission', 'sdlc', 'READ', 'Read SDLC repository and channel context', NOW()
WHERE NOT EXISTS (SELECT 1 FROM "public"."available_app_permissions" WHERE "name" = 'sdlc' AND "type" = 'READ');

INSERT INTO "public"."available_app_permissions" ("id", "name", "type", "description", "createdAt")
SELECT 'sdlc-write-permission', 'sdlc', 'WRITE', 'Create SDLC links and artifacts', NOW()
WHERE NOT EXISTS (SELECT 1 FROM "public"."available_app_permissions" WHERE "name" = 'sdlc' AND "type" = 'WRITE');

INSERT INTO "public"."available_app_permissions" ("id", "name", "type", "description", "createdAt")
SELECT 'search-read-permission', 'search', 'READ', 'Search workspace content the user can access', NOW()
WHERE NOT EXISTS (SELECT 1 FROM "public"."available_app_permissions" WHERE "name" = 'search' AND "type" = 'READ');

INSERT INTO "public"."available_app_permissions" ("id", "name", "type", "description", "createdAt")
SELECT 'activity-read-permission', 'activity', 'READ', 'Read activity history the user can see', NOW()
WHERE NOT EXISTS (SELECT 1 FROM "public"."available_app_permissions" WHERE "name" = 'activity' AND "type" = 'READ');

INSERT INTO "public"."available_app_permissions" ("id", "name", "type", "description", "createdAt")
SELECT 'canvas-read-permission', 'canvas', 'READ', 'Read canvases the user can access', NOW()
WHERE NOT EXISTS (SELECT 1 FROM "public"."available_app_permissions" WHERE "name" = 'canvas' AND "type" = 'READ');

INSERT INTO "public"."available_app_permissions" ("id", "name", "type", "description", "createdAt")
SELECT 'workflows-read-permission', 'workflows', 'READ', 'Read workflows and their executions the user can see', NOW()
WHERE NOT EXISTS (SELECT 1 FROM "public"."available_app_permissions" WHERE "name" = 'workflows' AND "type" = 'READ');
