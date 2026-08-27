-- The `create-react-artifact` tool was renamed to `create-app`. The catalog is
-- upserted BY SLUG on every claw-auth boot (bootstrap-tools.ts), so the rename
-- created a second row and orphaned the original instead of replacing it.
--
-- Left in place, the agent-config picker lists two entries that look like the
-- same tool. Selecting the old one writes "create-react-artifact" into
-- `config.tools.custom`, which matches no live tool name — the runtime gates
-- custom tools by name (xyne-claw run.ts), so the agent silently gets nothing
-- and the misconfiguration is invisible until someone wonders why the agent
-- cannot build an app.
--
-- Mirrors 20260515040000_remove_webfetch_tool (agent_tools first, then tools).

-- 1) Carry any existing selection across the rename, so an agent that had the
--    old tool picked keeps the capability instead of losing it silently.
--    jsonb_agg reorders, which is harmless: the runtime reads tools.custom into
--    a Set. DISTINCT collapses the duplicate when both slugs are present.
UPDATE "agents"
SET "config" = jsonb_set(
  "config",
  '{tools,custom}',
  (
    SELECT jsonb_agg(DISTINCT
      CASE WHEN elem = '"create-react-artifact"'::jsonb
           THEN '"create-app"'::jsonb
           ELSE elem END)
    FROM jsonb_array_elements("config"->'tools'->'custom') AS elem
  )
)
WHERE jsonb_typeof("config"->'tools'->'custom') = 'array'
  AND "config"->'tools'->'custom' @> '"create-react-artifact"'::jsonb;

-- 2) Drop grants pointing at the stale catalog row. (FK is ON DELETE CASCADE,
--    so this is belt-and-braces — explicit for parity with the webfetch removal.)
DELETE FROM "agent_tools"
WHERE "toolId" IN (SELECT "id" FROM "tools" WHERE "slug" = 'create-react-artifact');

-- 3) Remove the stale row. Nothing re-creates it: the shared registry no longer
--    contains that slug, and bootstrap only upserts what the registry exports.
DELETE FROM "tools"
WHERE "slug" = 'create-react-artifact';
