-- webfetch_high_limit: opt-in variant of webfetch for LARGE resources
-- (directory dumps, big JSON/CSV). Returns up to ~25MB vs webfetch's 80K chars;
-- claw's spill-to-disk keeps the LLM context safe (only a preview goes
-- inline). Added after the open-finance-sme incident (2026-07-16): the Brazil
-- Open Finance participants directory was silently cut at 80K and the agent
-- concluded Itaú was not a participant. No agent is auto-granted this tool —
-- selection is explicit, same as other System Tools.
--
-- MIRRORS the `webfetch` sibling (20260626000000_add_webfetch_system_tool):
--   • source = `custom:webfetch` so /tools/available buckets it into the
--     "System Tools" custom group, where classifyRisk(name, false) marks it
--     READ (green). Using `mcp:claw-builtin` — the deprecated source removed by
--     20260515 — instead routed it through the MCP-server branch and rendered
--     it as a WRITE tool (orange), wrong for a read-only fetch.
--   • slug MUST equal the selectionKey in mcp/adapters/webfetch.ts
--     ("webfetch_high_limit") — the runtime gates this direct tool against
--     `tools.custom` BY selectionKey, so a mismatched slug (e.g.
--     "claw-builtin__webfetch_high_limit") would also make it ungrantable.
-- Execution still happens in xyne-claw-auth (/mcp/call → handleWebfetch, highLimit).

-- Self-correct: drop the stale row if the earlier buggy version of this
-- migration (wrong slug + `mcp:claw-builtin` source) already inserted one.
DELETE FROM "tools" WHERE "slug" = 'claw-builtin__webfetch_high_limit';

INSERT INTO "tools" ("id", "slug", "name", "description", "source", "inputSchema", "enabled", "createdAt", "updatedAt")
VALUES (
  gen_random_uuid()::text,
  'webfetch_high_limit',
  'webfetch_high_limit',
  'Fetch an external URL like webfetch, but for LARGE resources: returns up to ~25MB (vs webfetch''s 80K chars). Use when fetching big data files — directory dumps, large JSON/CSV/API responses — where the entry you need may sit deep in the body. The result is saved to a file you can read/grep. Prefer plain webfetch for normal pages; this variant is slower and heavier.',
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
