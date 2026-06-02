-- Add BITBOT MCP server — PR analysis across Juspay Bitbucket repos.
-- The stdio adapter (src/mcp/adapters/bitbot.ts) launches
-- src/mcp/servers/bitbot-server.ts which proxies POST /api/prs/bulk on
-- the research-agent service. Access is gated by NAT-IP allowlist on the
-- upstream, no token required.
INSERT INTO "mcp_servers" ("id", "type", "name", "url", "description", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'bitbot', 'BitBot', 'stdio://bitbot', 'PR analysis across Juspay Bitbucket repos — bulk fetch PRs by repo + date range via the in-cluster pr-analysis service.', NOW(), NOW())
ON CONFLICT ("type") DO UPDATE SET
  "name" = EXCLUDED."name",
  "url" = EXCLUDED."url",
  "description" = EXCLUDED."description",
  "updatedAt" = NOW();
