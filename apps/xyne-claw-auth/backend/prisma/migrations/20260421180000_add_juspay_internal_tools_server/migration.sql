-- Add Juspay Internal Tools MCP server
INSERT INTO "mcp_servers" ("id", "type", "name", "url", "description", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'juspay-internal-tools', 'Juspay Internal Tools', '', 'Juspay internal tools MCP server for merchant flow and product data retrieval; configure URL through private deployment config', NOW(), NOW())
ON CONFLICT ("type") DO UPDATE SET
  "name" = EXCLUDED."name",
  "url" = EXCLUDED."url",
  "description" = EXCLUDED."description",
  "updatedAt" = NOW();
