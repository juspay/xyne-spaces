-- Register the RapidAPI LinkedIn MCP server (type='rapidapi-linkedin').
-- Prod does not run prisma/seed.ts on every deploy, so a migration is the
-- reliable way to ensure the row exists in the mcp_servers table.
--
-- Mirrors the adapter definition in src/mcp/adapters/rapidapi-linkedin.ts.
-- Idempotent — ON CONFLICT (type) DO UPDATE keeps the migration safe to
-- re-run and lets future changes (e.g. updated description) propagate.

INSERT INTO "mcp_servers" (
  "id",
  "type",
  "name",
  "url",
  "description",
  "transport",
  "credentialForm",
  "launchConfigTemplate",
  "healthcheckSpec",
  "writeToolPolicy",
  "createdAt",
  "updatedAt"
)
VALUES (
  gen_random_uuid()::text,
  'rapidapi-linkedin',
  'RapidAPI LinkedIn',
  '',
  'LinkedIn intelligence via the Fresh LinkedIn Profile Data API on RapidAPI — profile lookups, employee search, people search, and advanced lead discovery.',
  'stdio',
  '{"fields":[{"name":"apiKey","label":"X-RapidAPI-Key","type":"password","placeholder":"your-rapidapi-key"}]}'::jsonb,
  -- Launch config used only when no static adapter is registered for this type.
  -- The static adapter (src/mcp/adapters/rapidapi-linkedin.ts) overrides this
  -- at runtime; keeping the JSON internally consistent so a future removal of
  -- the static adapter or a fresh install still resolves correctly. Server
  -- now lives in src/mcp/servers/ (covered by tsc); the runner rewrites the
  -- bare "tsx/esm" specifier into an absolute file:// URL.
  '{"cmd":"node","args":["--import","tsx/esm","src/mcp/servers/linkedin-rapidapi-server.ts"],"env":{"RAPIDAPI_KEY":"{{apiKey}}"}}'::jsonb,
  '{"name":"linkedin_get_profile","params":{"linkedin_url":"https://www.linkedin.com/in/williamhgates"}}'::jsonb,
  '{"mode":"allowlist","tools":[]}'::jsonb,
  NOW(),
  NOW()
)
ON CONFLICT ("type") DO UPDATE SET
  "name"                 = EXCLUDED."name",
  "url"                  = EXCLUDED."url",
  "description"          = EXCLUDED."description",
  "transport"            = EXCLUDED."transport",
  "credentialForm"       = EXCLUDED."credentialForm",
  "launchConfigTemplate" = EXCLUDED."launchConfigTemplate",
  "healthcheckSpec"      = EXCLUDED."healthcheckSpec",
  "writeToolPolicy"      = EXCLUDED."writeToolPolicy",
  "updatedAt"            = NOW();
