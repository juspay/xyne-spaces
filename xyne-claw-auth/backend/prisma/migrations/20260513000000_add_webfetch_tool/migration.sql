INSERT INTO "tools" ("id", "slug", "name", "description", "source", "inputSchema", "enabled", "createdAt", "updatedAt")
VALUES (
  gen_random_uuid()::text,
  'claw-builtin__webfetch',
  'webfetch',
  'Fetch an external URL and return its content as clean markdown text. Uses Mozilla Readability for article extraction and Turndown for HTML→markdown conversion. Only use for URLs outside Xyne Spaces (e.g. external links from messages which are not accessible from other subagents). Do NOT use for Xyne Spaces internal URLs — use the spaces-* tools instead.',
  'mcp:claw-builtin',
  '{"type":"object","properties":{"url":{"type":"string","description":"The URL to fetch"}},"required":["url"]}'::jsonb,
  true,
  NOW(),
  NOW()
)
ON CONFLICT ("slug") DO UPDATE SET
  "name"        = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "source"      = EXCLUDED."source",
  "inputSchema" = EXCLUDED."inputSchema",
  "updatedAt"   = NOW();

INSERT INTO "agent_tools" ("id", "agentId", "toolId", "permission")
SELECT gen_random_uuid()::text, a."id", t."id", 'allow'
FROM "agents" a, "tools" t
WHERE a."slug" IN ('assistant')
AND t."slug" = 'claw-builtin__webfetch'
ON CONFLICT ("agentId", "toolId") DO NOTHING;
