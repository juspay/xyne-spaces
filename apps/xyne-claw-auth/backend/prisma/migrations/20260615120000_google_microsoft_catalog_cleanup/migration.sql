-- Google/Microsoft tool-catalog cleanup for the move from in-process custom
-- tools → per-user OAuth MCP connectors.
--   • runtime:  src/mcp/adapters/{google,microsoft}.ts + servers/{google,microsoft}-server.ts
--   • creds:    per-user OAuth (credentials-loader resolveFreshOAuthCreds) — no migration
--   • catalog:  THIS migration
--   • agents:   companion migration 20260615120100_google_microsoft_agent_tools
--
-- 1) Ensure the google/microsoft connector rows exist + enabled so tool-sync
--    surfaces mcp:google / mcp:microsoft and the agent-config picker lists them
--    under Connectors. (Seed + the OAuth-connect flow also create them; ensured
--    here so the catalog is never empty after the delete below.)
INSERT INTO "mcp_servers" ("id", "type", "name", "url", "description", "enabled", "transport", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'google',    'Google',    '', 'Google OAuth integration (Gmail, Calendar, Contacts, Tasks, Drive)',               true, 'stdio', NOW(), NOW()),
  (gen_random_uuid()::text, 'microsoft', 'Microsoft', '', 'Microsoft OAuth integration (Outlook, Calendar, Contacts, To Do, OneDrive, Teams)', true, 'stdio', NOW(), NOW())
ON CONFLICT ("type") DO UPDATE SET
  "enabled" = true,
  "updatedAt" = NOW();

-- 2) Remove the stale custom:google / custom:microsoft catalog rows. They are no
--    longer in-process custom tools (bootstrap-tools.ts no longer re-seeds them),
--    but lingering rows make the picker list them under "Custom tools". AgentTool
--    links cascade-delete (FK onDelete: Cascade) — cleanup only; runtime access is
--    the per-user MCP path and agent selections move in the companion migration.
DELETE FROM "tools" WHERE "source" IN ('custom:google', 'custom:microsoft');
