-- Add the global Research Agent MCP server row.
--
-- Runtime is implemented as a reviewed static stdio adapter:
--   • adapter:      src/mcp/adapters/research-agent-mcp.ts
--   • stdio server: src/mcp/servers/research-agent-mcp-server.ts
--
-- The API key is sourced from RESEARCH_AGENT_MCP_API_KEY (or the legacy
-- lowercase research_agent_mcp_api_key env) by credentials-loader; there is no
-- browser login flow and no per-user connection requirement.

INSERT INTO "mcp_servers" ("id", "type", "name", "url", "description", "createdAt", "updatedAt")
VALUES (
  gen_random_uuid()::text,
  'research-agent-mcp',
  'Research Agent MCP',
  '',
  'Global stdio MCP proxy for Research Agent REST tools.',
  NOW(),
  NOW()
)
ON CONFLICT ("type") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "updatedAt" = NOW();
