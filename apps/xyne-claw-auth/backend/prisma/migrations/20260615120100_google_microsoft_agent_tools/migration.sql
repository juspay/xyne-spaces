-- Migrate each agent's config.tools selections for the google/microsoft move.
-- SQL equivalent of scripts/migrate-google-microsoft-tools.ts (which has a
-- --dry-run; PREVIEW with that first to confirm the exact per-agent diff before
-- applying this — migrations have no dry-run).
--
-- Rules (faithful — preserves each agent's exact tool surface):
--   A) Per-tool agents: move every `google-*` / `microsoft-*` slug from
--      tools.custom[] into tools.direct[] (same slug = same live MCP tool name;
--      run.ts surfaces a direct pick on the parent).
--   B) Legacy full-access agents `google-agent` / `microsoft-agent` (which got
--      the WHOLE toolset via an agentSlug allow, not via config): add the whole
--      connector to tools.subagents[] instead of per-tool picks.
--
-- Agents with NO `tools` object are left untouched (no filter = they already see
-- every resolved connector incl. the new google/microsoft MCP). Legacy-slug
-- agents in that state should be reviewed manually (the script flags them).

-- ── A) Per-tool: custom[] google-*/microsoft-* → direct[] (deduped) ──────────
UPDATE "agents" a
SET "config" = jsonb_set(
  jsonb_set(
    a."config",
    '{tools,custom}',
    COALESCE((
      SELECT jsonb_agg(e)
      FROM jsonb_array_elements_text(a."config"->'tools'->'custom') AS e
      WHERE e NOT LIKE 'google-%' AND e NOT LIKE 'microsoft-%'
    ), '[]'::jsonb)
  ),
  '{tools,direct}',
  (
    SELECT COALESCE(jsonb_agg(DISTINCT e), '[]'::jsonb)
    FROM jsonb_array_elements_text(
      COALESCE(a."config"->'tools'->'direct', '[]'::jsonb)
      || COALESCE((
           SELECT jsonb_agg(e2)
           FROM jsonb_array_elements_text(a."config"->'tools'->'custom') AS e2
           WHERE e2 LIKE 'google-%' OR e2 LIKE 'microsoft-%'
         ), '[]'::jsonb)
    ) AS e
  )
)
WHERE jsonb_typeof(a."config"->'tools'->'custom') = 'array'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(a."config"->'tools'->'custom') AS e
    WHERE e LIKE 'google-%' OR e LIKE 'microsoft-%'
  );

-- ── B) Legacy full-access agents → add whole connector to subagents[] ────────
UPDATE "agents" a
SET "config" = jsonb_set(
  a."config",
  '{tools,subagents}',
  (
    SELECT COALESCE(jsonb_agg(DISTINCT e), '[]'::jsonb)
    FROM jsonb_array_elements_text(
      COALESCE(a."config"->'tools'->'subagents', '[]'::jsonb)
      || (CASE WHEN a."slug" = 'google-agent' THEN '["google"]'::jsonb ELSE '["microsoft"]'::jsonb END)
    ) AS e
  )
)
WHERE a."slug" IN ('google-agent', 'microsoft-agent')
  AND jsonb_typeof(a."config"->'tools') = 'object';   -- only agents that already have a tools filter
