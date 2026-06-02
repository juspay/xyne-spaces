-- XYNE-12851: add 7 new MCP integrations (BigQuery, Databricks, Slack, Shopify,
-- Intercom, Asana, Salesforce) in a single migration.
-- Each row uses ON CONFLICT (type) DO UPDATE so the migration is idempotent and
-- safe to re-run if the same server already exists with stale fields.
-- Full credentialForm / launchConfigTemplate / healthcheckSpec / writeToolPolicy
-- payloads are populated by prisma/seed.ts after this migration runs.

INSERT INTO "mcp_servers" ("id", "type", "name", "url", "description", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'bigquery',   'BigQuery',   '', 'Google BigQuery data warehouse — query datasets, explore schemas, list tables', NOW(), NOW()),
  (gen_random_uuid()::text, 'databricks', 'Databricks', '', 'Databricks workspace — manage clusters, jobs, notebooks, execute SQL, browse files and Unity Catalog volumes', NOW(), NOW()),
  (gen_random_uuid()::text, 'slack',      'Slack',      '', 'Slack workspace — search messages, list channels, read conversations, post messages', NOW(), NOW()),
  (gen_random_uuid()::text, 'shopify',    'Shopify',    '', 'Shopify store — manage products, orders, customers, discounts, and inventory via GraphQL Admin API', NOW(), NOW()),
  (gen_random_uuid()::text, 'intercom',   'Intercom',   '', 'Intercom — search contacts, read conversations, list companies via official MCP', NOW(), NOW()),
  (gen_random_uuid()::text, 'asana',      'Asana',      '', 'Asana — manage tasks, projects, sections, and workspaces via Personal Access Token', NOW(), NOW()),
  (gen_random_uuid()::text, 'salesforce', 'Salesforce', '', 'Salesforce CRM — SOQL, objects, DML, metadata and Apex via acquis-salesforce-mcp (username + password + security token)', NOW(), NOW())
ON CONFLICT ("type") DO UPDATE SET
  "name"        = EXCLUDED."name",
  "url"         = EXCLUDED."url",
  "description" = EXCLUDED."description",
  "updatedAt"   = NOW();
