-- =============================================================================
-- Ask AI → Workflows : claw-auth database changes
--
-- Target : the XYNE-CLAW-AUTH database (NOT the Spaces database).
-- Effect : registers the xyne-workflows MCP server, pins it to the `ask-ai`
--          agent, and adds its 11 tools to that agent's tool allowlist.
-- Equivalent to: `npm run db:seed` (workflow portion only).
--
-- Safe to re-run: every statement is idempotent.
-- Wrap in a transaction; nothing here is destructive.
-- =============================================================================
BEGIN;

-- ── 1. Register the MCP server ───────────────────────────────────────────────
-- `id` is a Prisma cuid, normally generated client-side. Any unique string works;
-- this fixed one keeps re-runs idempotent and the row easy to find.
INSERT INTO "mcp_servers" (
  id, name, type, url, description, enabled, transport,
  "credentialForm", "writeToolPolicy", "connectorMeta",
  "isOauth", "allowGlobalFallback", "forwardFiles",
  "createdAt", "updatedAt"
) VALUES (
  gen_random_uuid()::text,
  'Xyne Workflows',
  'xyne-workflows',
  '',
  'Workflow authoring and run tools for Ask AI (pinned; not user-connectable).',
  true,
  'stdio',
  '{"fields": []}'::jsonb,
  '{"mode": "allowlist", "tools": ["workflow_create", "workflow_update", "workflow_run"]}'::jsonb,
  '{"seeded": true, "version": 1}'::jsonb,
  false, false, false,
  now(), now()
)
ON CONFLICT (type) DO UPDATE SET
  name               = EXCLUDED.name,
  url                = EXCLUDED.url,
  description        = EXCLUDED.description,
  transport          = EXCLUDED.transport,
  "credentialForm"   = EXCLUDED."credentialForm",
  "writeToolPolicy"  = EXCLUDED."writeToolPolicy",
  "connectorMeta"    = EXCLUDED."connectorMeta",
  enabled            = true,
  "updatedAt"        = now();

-- ── 2. Pin the server to the `ask-ai` agent ──────────────────────────────────
-- This row is what makes /mcp/tools list the server for this agent, and ONLY
-- this agent. The encrypted columns are placeholders on purpose: credentials for
-- this server type are synthesized from the caller's live Spaces session
-- (lib/credentials-loader.ts returns before any decrypt), so the stored blob is
-- never read. They are NOT NULL, hence the empty strings.
INSERT INTO "agent_mcp_connections" (
  id, "agentId", "mcpServerId", slug,
  "encryptedCreds", iv, "authTag", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text, a.id, s.id, 'default',
  '', '', '', now(), now()
FROM "agents" a
CROSS JOIN "mcp_servers" s
WHERE a.slug = 'ask-ai'
  AND s.type = 'xyne-workflows'
ON CONFLICT ("agentId", "mcpServerId", slug) DO NOTHING;

-- ── 3. Allow the tools on the `ask-ai` agent ─────────────────────────────────
-- `config.tools.direct` is a STRICT allowlist: a tool missing here is dropped
-- silently — the server still loads, the tool just never reaches the agent.
-- Appends only what is absent, so re-running adds nothing and reorders nothing.
UPDATE "agents" SET config = jsonb_set(
  config::jsonb,
  '{tools,direct}',
  (
    SELECT COALESCE(jsonb_agg(DISTINCT t), '[]'::jsonb)
    FROM (
      SELECT jsonb_array_elements(COALESCE(config::jsonb #> '{tools,direct}', '[]'::jsonb)) AS t
      UNION
      SELECT to_jsonb(x) FROM unnest(ARRAY[
        'workflow_catalog', 'workflow_node_context', 'workflow_list', 'workflow_get',
        'workflow_validate', 'workflow_create', 'workflow_update', 'workflow_run',
        'workflow_run_get', 'workflow_run_list', 'workflow_step_events'
      ]) AS x
    ) merged
  ),
  true
)
WHERE slug = 'ask-ai'
  AND config::jsonb #> '{tools,direct}' IS NOT NULL;

-- ── 4. Require approval for the three write tools ────────────────────────────
-- Belt and braces: the adapter's writeTools already forces these to "ask" at the
-- /call boundary. Stated here so the agent's configured surface agrees.
UPDATE "agents" SET config = jsonb_set(
  config::jsonb,
  '{toolPermissions}',
  COALESCE(config::jsonb -> 'toolPermissions', '{}'::jsonb) || jsonb_build_object(
    'xyne-workflows__workflow_create', 'ask',
    'xyne-workflows__workflow_update', 'ask',
    'xyne-workflows__workflow_run',    'ask'
  ),
  true
)
WHERE slug = 'ask-ai';

COMMIT;

-- ── Verification (expect: 1 server, 1 connection, 11 tools, 3 permissions) ───
-- SELECT count(*) FROM mcp_servers WHERE type = 'xyne-workflows';
-- SELECT count(*) FROM agent_mcp_connections c
--   JOIN agents a ON a.id = c."agentId" JOIN mcp_servers s ON s.id = c."mcpServerId"
--   WHERE a.slug = 'ask-ai' AND s.type = 'xyne-workflows';
-- SELECT jsonb_array_length(config::jsonb #> '{tools,direct}') AS total,
--        (SELECT count(*) FROM jsonb_array_elements_text(config::jsonb #> '{tools,direct}') t
--         WHERE t LIKE 'workflow\_%') AS workflow_tools
--   FROM agents WHERE slug = 'ask-ai';
