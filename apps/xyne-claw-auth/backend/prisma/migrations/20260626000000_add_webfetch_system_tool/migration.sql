-- Re-introduce the built-in `webfetch` tool, this time catalogued as a
-- **System Tool** (source `custom:*`) rather than under the "Built-in" MCP
-- server group (the prior `20260513…_add_webfetch_tool` used `mcp:claw-builtin`
-- and was removed by `20260515…_remove_webfetch_tool`).
--
-- Source `custom:webfetch` makes `/api/v1/tools/available` bucket it into
-- `customGroups` (the "System Tools" picker section), so selection lands in the
-- agent's `tools.custom[]` by SLUG. Execution still happens entirely in
-- xyne-claw-auth (`/mcp/call` → handleWebfetch) — the tool is surfaced to the
-- runtime via `/mcp/tools` under serverType `claw-builtin`, and the runtime
-- gates this direct tool against `tools.custom` via its `selectionKey`
-- (= the slug below). See mcp/adapters/webfetch.ts and the directTools branch
-- in xyne-claw/src/routes/run.ts.
--
-- NOTE: the slug here MUST match WEBFETCH_SELECTION_KEY in
-- mcp/adapters/webfetch.ts ("webfetch"). No agent_tools grant is inserted:
-- agents opt in by listing the slug in their `tools.custom` config, not via the
-- agent_tools allowlist.
INSERT INTO "tools" ("id", "slug", "name", "description", "source", "inputSchema", "enabled", "createdAt", "updatedAt")
VALUES (
  gen_random_uuid()::text,
  'webfetch',
  'webfetch',
  'Fetch an external URL and return its content as clean markdown text. Uses Mozilla Readability for article extraction and Turndown for HTML→markdown conversion. Only use for URLs outside Xyne Spaces (e.g. external links from messages which are not accessible from other subagents). Do NOT use for Xyne Spaces internal URLs — use the spaces-* tools instead.',
  'custom:webfetch',
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
  "enabled"     = true,
  "updatedAt"   = NOW();
