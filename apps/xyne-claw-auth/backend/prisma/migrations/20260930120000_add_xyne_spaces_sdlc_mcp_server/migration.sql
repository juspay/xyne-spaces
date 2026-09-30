INSERT INTO "mcp_servers" ("id", "type", "name", "url", "description", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'xyne-spaces-sdlc', 'Xyne Spaces SDLC', '', 'SDLC Hub tools (tracks, artifacts, pull requests); listed for SDLC runs, not user-connectable.', NOW(), NOW())
ON CONFLICT ("type") DO NOTHING;
