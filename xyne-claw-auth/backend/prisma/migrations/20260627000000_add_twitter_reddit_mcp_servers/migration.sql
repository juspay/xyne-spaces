-- Register the in-tree `twitter` and `reddit` MCP servers as connectable
-- mcp_servers rows. These are code-defined STATIC adapters (see
-- src/mcp/adapters/{twitter,reddit}.ts + src/mcp/servers/*-server.ts), but a
-- DB row is still required so they (a) appear in the connect UI — GET /servers
-- lists mcp_servers rows only — and (b) provide the McpServer.id that
-- user_mcp_connections.mcpServerId references when a user stores credentials.
--
-- Mirrors the entries added to prisma/seed.ts. Both are READ-ONLY (empty write
-- tool policy). NO launchConfigTemplate: for stdio types the launch command is
-- resolved from the code-reviewed static adapter, never from the DB row.
--
-- Idempotent: ON CONFLICT (type) DO NOTHING so re-running migrate (or a row
-- already created via the self-serve connector flow) is a no-op and never
-- overwrites admin edits.
INSERT INTO "mcp_servers" (
  "id", "name", "type", "url", "description", "transport",
  "credentialForm", "healthcheckSpec", "writeToolPolicy", "connectorMeta",
  "createdAt", "updatedAt"
)
VALUES
  (
    gen_random_uuid()::text,
    'Twitter / X',
    'twitter',
    '',
    'Twitter / X — search recent tweets (read-only).',
    'stdio',
    '{"fields":[{"name":"apiKey","label":"API Key","type":"password","placeholder":"consumer API key"},{"name":"apiSecretKey","label":"API Secret Key","type":"password","placeholder":"consumer API secret"},{"name":"accessToken","label":"Access Token","type":"password","placeholder":"user access token"},{"name":"accessTokenSecret","label":"Access Token Secret","type":"password","placeholder":"user access token secret"}]}'::jsonb,
    '{"name":"search_tweets","params":{"query":"test","count":10}}'::jsonb,
    '{"mode":"allowlist","tools":[]}'::jsonb,
    '{"seeded":true,"version":1}'::jsonb,
    NOW(),
    NOW()
  ),
  (
    gen_random_uuid()::text,
    'Reddit',
    'reddit',
    '',
    'Reddit — search, browse subreddits, read comments and subreddit info (read-only).',
    'stdio',
    '{"fields":[{"name":"clientId","label":"Reddit Client ID","type":"password","placeholder":"app client id"},{"name":"clientSecret","label":"Reddit Client Secret","type":"password","placeholder":"app client secret"},{"name":"userAgent","label":"User-Agent (optional)","type":"text","placeholder":"myapp/1.0 by u/you","optional":true}]}'::jsonb,
    '{"name":"get_subreddit_info","params":{"subreddit":"announcements"}}'::jsonb,
    '{"mode":"allowlist","tools":[]}'::jsonb,
    '{"seeded":true,"version":1}'::jsonb,
    NOW(),
    NOW()
  )
ON CONFLICT ("type") DO NOTHING;
