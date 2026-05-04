-- Add Juspay Internal Tools MCP server
INSERT INTO "mcp_servers" ("id", "type", "name", "url", "description", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'juspay-internal-tools', 'Juspay Internal Tools', 'https://lightbox.sso.internal.svc.k8s.apoc.mum.juspay.net/api/juspay-internal/xyne-tools', 'Juspay internal tools MCP server for merchant flow and product data retrieval', NOW(), NOW())
ON CONFLICT ("type") DO UPDATE SET
  "name" = EXCLUDED."name",
  "url" = EXCLUDED."url",
  "description" = EXCLUDED."description",
  "updatedAt" = NOW();
