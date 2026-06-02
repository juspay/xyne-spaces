-- Register the GitHub MCP server (type='github') with the full connector
-- configuration. Prod does not run prisma/seed.ts on every deploy, so a
-- migration is the reliable way to ensure the row exists.
--
-- Mirrors the entry in prisma/seed.ts (~L88-109). Idempotent — ON CONFLICT
-- (type) DO UPDATE keeps the migration safe to re-run and lets future
-- adapter tweaks (added write tools, etc.) propagate via repeated deploys.

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
  'github',
  'GitHub',
  '',
  'GitHub integration for repositories, issues, and pull requests via @modelcontextprotocol/server-github',
  'stdio',
  '{"fields":[{"name":"token","label":"GitHub Personal Access Token","type":"password","placeholder":"ghp_xxxxxxxxxxxxxxxxxxxx"}]}'::jsonb,
  '{"cmd":"npx","args":["-y","@modelcontextprotocol/server-github"],"env":{"GITHUB_TOKEN":"{{token}}","GITHUB_PERSONAL_ACCESS_TOKEN":"{{token}}"}}'::jsonb,
  '{"name":"search_repositories","params":{"query":"test"}}'::jsonb,
  '{"mode":"allowlist","tools":["create_repository","fork_repository","push_files","create_or_update_file","create_branch","create_issue","update_issue","add_issue_comment","create_pull_request","merge_pull_request","update_pull_request_branch"]}'::jsonb,
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
