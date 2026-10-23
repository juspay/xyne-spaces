-- Catalog rows for the OAuth (browser sign-in) Fireflies and Jira (Atlassian
-- Rovo) connectors, so they are listed before anyone connects.
-- Health check, write tools and credential fields come from
-- src/mcp/adapters/{fireflies,atlassian}-remote.ts, not these rows.
-- Values mirror ensureServer() in src/lib/mcp-oauth-provider.ts.
-- DO NOTHING: safe to re-run; never overwrites a row created by a sign-in.
INSERT INTO "mcp_servers"
  ("id", "type", "name", "url", "description", "transport", "isOauth", "connectorMeta", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'fireflies-remote', 'Fireflies', 'https://api.fireflies.ai/mcp',
   'Fireflies meeting notes — search meetings, read transcripts, summaries and action items, and share or organise meetings.',
   'http', true, '{"scope":"global","mode":"self-serve"}'::jsonb, NOW(), NOW()),
  (gen_random_uuid()::text, 'atlassian-remote', 'Jira', 'https://mcp.atlassian.com/v1/mcp',
   'Jira & Confluence (Atlassian) — search with JQL, read, create, edit and transition issues, and work with Confluence pages.',
   'http', true, '{"scope":"global","mode":"self-serve"}'::jsonb, NOW(), NOW())
ON CONFLICT ("type") DO NOTHING;
