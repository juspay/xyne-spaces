-- Replace the approval-card orchestrator tool with immediate agent dispatch.
-- Preserve existing agent selections while changing the catalog slug.

UPDATE "agents"
SET "config" = jsonb_set(
  "config",
  '{tools,custom}',
  (
    SELECT jsonb_agg(DISTINCT
      CASE WHEN elem = '"propose-agent-call"'::jsonb
           THEN '"perform_agent_call"'::jsonb
           ELSE elem END)
    FROM jsonb_array_elements("config"->'tools'->'custom') AS elem
  )
)
WHERE jsonb_typeof("config"->'tools'->'custom') = 'array'
  AND "config"->'tools'->'custom' @> '"propose-agent-call"'::jsonb;

UPDATE "tools"
SET
  "slug" = 'perform_agent_call',
  "name" = 'Perform agent call',
  "description" = 'Run another visible agent immediately with a self-contained task in this same Spaces thread.',
  "inputSchema" = '{"type":"object","properties":{"agentSlug":{"type":"string","description":"Slug of the target agent to run."},"task":{"type":"string","description":"Self-contained task the target agent should run."}},"required":["agentSlug","task"]}'::jsonb,
  "updatedAt" = NOW()
WHERE "slug" = 'propose-agent-call'
  AND NOT EXISTS (SELECT 1 FROM "tools" WHERE "slug" = 'perform_agent_call');

-- Normalize a pre-existing target row too (partial rollout / bootstrap first).
UPDATE "tools"
SET
  "name" = 'Perform agent call',
  "description" = 'Run another visible agent immediately with a self-contained task in this same Spaces thread.',
  "inputSchema" = '{"type":"object","properties":{"agentSlug":{"type":"string","description":"Slug of the target agent to run."},"task":{"type":"string","description":"Self-contained task the target agent should run."}},"required":["agentSlug","task"]}'::jsonb,
  "updatedAt" = NOW()
WHERE "slug" = 'perform_agent_call';

-- If the new row already exists (for example after a partial rollout), carry
-- relational grants across before removing the stale catalog row.
INSERT INTO "agent_tools" ("id", "agentId", "toolId", "permission")
SELECT
  md5(old_grant."agentId" || ':' || new_tool."id"),
  old_grant."agentId",
  new_tool."id",
  old_grant."permission"
FROM "agent_tools" old_grant
JOIN "tools" old_tool ON old_tool."id" = old_grant."toolId"
JOIN "tools" new_tool ON new_tool."slug" = 'perform_agent_call'
WHERE old_tool."slug" = 'propose-agent-call'
ON CONFLICT ("agentId", "toolId") DO NOTHING;

DELETE FROM "agent_tools"
WHERE "toolId" IN (SELECT "id" FROM "tools" WHERE "slug" = 'propose-agent-call');

DELETE FROM "tools" WHERE "slug" = 'propose-agent-call';
