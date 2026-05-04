-- Add SequentialThinking MCP server
INSERT INTO "mcp_servers" ("id", "type", "name", "url", "description", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'sequentialthinking', 'SequentialThinking', '', 'An MCP server implementation that provides a tool for dynamic and reflective problem-solving through a structured thinking process', NOW(), NOW())
ON CONFLICT ("type") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "updatedAt" = NOW();
