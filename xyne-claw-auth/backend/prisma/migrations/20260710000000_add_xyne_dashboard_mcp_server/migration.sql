-- Register the in-tree `xyne-dashboard` MCP server — the dedicated
-- dynamic-dashboard toolset for the `dashboard-ai` agent. Code-defined static
-- adapter (src/mcp/adapters/xyne-dashboard.ts + servers/xyne-dashboard-server.ts);
-- this row is the catalog entry that lets /mcp/tools resolve the server and
-- provides the McpServer.id for the agent_mcp_connections FK (the pin is seeded
-- in prisma/seed.ts, mirroring every other agent/pin in this repo).
--
-- Not user-connectable: credentialForm is empty and credentials-loader.ts
-- short-circuits xyne-dashboard to the user's LIVE Spaces session, so the stored
-- (empty) connection creds are never read. writeToolPolicy is an empty allowlist
-- — dashboard edits are autonomous by design and every plan is server-validated
-- before persisting. transport = stdio (spawned per-user by the static adapter).
-- Idempotent: ON CONFLICT (type) keeps the row in sync across environments.
INSERT INTO "mcp_servers" (
  "id", "name", "type", "url", "description", "transport",
  "credentialForm", "healthcheckSpec", "writeToolPolicy", "connectorMeta",
  "createdAt", "updatedAt"
)
VALUES (
  gen_random_uuid()::text,
  'Xyne Dashboard',
  'xyne-dashboard',
  '',
  'Dedicated dynamic-dashboard tools for the dashboard-ai agent (pinned; not user-connectable).',
  'stdio',
  '{"fields":[]}'::jsonb,
  '{"name":"suggest_components","params":{"message":"health check","suggestions":[{"label":"ok","prompt":"ok"}]}}'::jsonb,
  '{"mode":"allowlist","tools":[]}'::jsonb,
  '{"seeded":true,"version":1}'::jsonb,
  NOW(),
  NOW()
)
ON CONFLICT ("type") DO UPDATE SET
  "name"            = EXCLUDED."name",
  "url"             = EXCLUDED."url",
  "description"     = EXCLUDED."description",
  "transport"       = EXCLUDED."transport",
  "credentialForm"  = EXCLUDED."credentialForm",
  "healthcheckSpec" = EXCLUDED."healthcheckSpec",
  "writeToolPolicy" = EXCLUDED."writeToolPolicy",
  "connectorMeta"   = EXCLUDED."connectorMeta",
  "updatedAt"       = NOW();
