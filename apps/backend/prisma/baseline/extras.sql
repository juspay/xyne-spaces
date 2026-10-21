CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE SEQUENCE IF NOT EXISTS "ticket_xyne_id_seq" START WITH 1 INCREMENT BY 1;

CREATE UNIQUE INDEX IF NOT EXISTS "canvas_folders_projectId_name_project_scope_key" ON "public"."canvas_folders"("projectId", "name") WHERE "projectId" IS NOT NULL AND "channelId" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "canvas_folders_createdBy_name_personal_scope_key" ON "public"."canvas_folders"("createdBy", "name") WHERE "projectId" IS NULL AND "channelId" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "call_recordings_one_active" ON "non_zero"."call_recordings"("callId") WHERE "status" = 'RECORDING_ACTIVE';
CREATE INDEX IF NOT EXISTS "tickets_rootId_idx" ON "public"."tickets"("rootId") WHERE "rootId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "entity_aliases_normalizedForm_trgm_idx" ON "non_zero"."entity_aliases" USING gin ("normalizedForm" gin_trgm_ops);

INSERT INTO "public"."resources" ("id", "name", "description", "createdAt", "updatedAt")
SELECT v.id, v.name, v.description, NOW(), NOW()
FROM (VALUES
  ('ticket-migration-resource', 'TICKET-MIGRATION', 'Admin access to Jira and ticket migration workflows'),
  ('confluence-migration-resource', 'CONFLUENCE-MIGRATION', 'Admin access to Confluence migration workflows'),
  ('automations-resource', 'AUTOMATIONS', 'Admin access to manage workspace automations (approve/revoke proposals, view runs)'),
  ('ticket-reports-resource', 'TICKET-REPORTS', 'Ticket report export endpoints (/api/ticket-reports/*)')
) AS v(id, name, description)
WHERE NOT EXISTS (SELECT 1 FROM "public"."resources" r WHERE r."name" = v.name);

INSERT INTO "public"."available_app_permissions" ("id", "name", "type", "description", "createdAt")
SELECT 'workflows-start-permission', 'workflows', 'START', 'Start attached workflows from apps', NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "public"."available_app_permissions" WHERE "name" = 'workflows' AND "type" = 'START'
);
