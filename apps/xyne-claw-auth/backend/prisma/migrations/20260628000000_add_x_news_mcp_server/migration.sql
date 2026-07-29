-- Register the in-tree `x-news` MCP server (reads public X/Twitter posts via the
-- TwitterAPI.io third-party data API — no X account/app, just a TwitterAPI.io
-- key). Code-defined static adapter (src/mcp/adapters/x-news.ts +
-- servers/x-news-server.ts); this row makes it appear in the connect UI and
-- provides the McpServer.id for the user_mcp_connections FK. Read-only.
-- No launchConfigTemplate (stdio resolves via the code-reviewed static adapter).
-- Idempotent: ON CONFLICT (type) DO NOTHING.
INSERT INTO "mcp_servers" (
  "id", "name", "type", "url", "description", "transport",
  "credentialForm", "healthcheckSpec", "writeToolPolicy", "connectorMeta",
  "createdAt", "updatedAt"
)
VALUES (
  gen_random_uuid()::text,
  'X (AI accounts)',
  'x-news',
  '',
  'Read public X/Twitter posts (specific handles + search) via TwitterAPI.io — no X account needed. Read-only.',
  'stdio',
  '{"fields":[{"name":"apiKey","label":"TwitterAPI.io API Key","type":"password","placeholder":"your twitterapi.io key"}]}'::jsonb,
  '{"name":"get_user_tweets","params":{"username":"OpenAI","count":1}}'::jsonb,
  '{"mode":"allowlist","tools":[]}'::jsonb,
  '{"seeded":true,"version":1}'::jsonb,
  NOW(),
  NOW()
)
ON CONFLICT ("type") DO NOTHING;
