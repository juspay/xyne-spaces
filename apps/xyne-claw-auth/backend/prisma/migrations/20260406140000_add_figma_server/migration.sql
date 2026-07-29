-- Add Figma MCP server
INSERT INTO "mcp_servers" ("id", "type", "name", "url", "description", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'figma', 'Figma', '', 'Figma design platform — view files, read and post comments', NOW(), NOW())
ON CONFLICT ("type") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "updatedAt" = NOW();
