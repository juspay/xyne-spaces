-- Read-only agent-config introspection tools, catalogued as System Tools
-- (source `custom:agent-introspect`). Mirrors the webfetch system-tool pattern:
-- the slug here MUST match the selectionKey in mcp/adapters/agent-introspect.ts.
-- Execution is inline in routes/mcp.ts under the `claw-builtin` server type;
-- agents opt in by listing the slug in their `tools.custom` config. No
-- agent_tools grant is inserted.
INSERT INTO "tools" ("id", "slug", "name", "description", "source", "inputSchema", "enabled", "createdAt", "updatedAt")
VALUES
  (
    gen_random_uuid()::text,
    'list_agents',
    'List agents',
    'List all agents with a summary of their configuration (tools, subagents, skills, KB scope). Read-only.',
    'custom:agent-introspect',
    '{"type":"object","properties":{"enabledOnly":{"type":"boolean","description":"If true, only return enabled agents."}},"required":[]}'::jsonb,
    true, NOW(), NOW()
  ),
  (
    gen_random_uuid()::text,
    'get_agent_config',
    'Get agent config',
    'Get one agent''s full configuration by slug (system prompt, config, skills, KB grants). Read-only; no secrets.',
    'custom:agent-introspect',
    '{"type":"object","properties":{"slug":{"type":"string","description":"The agent slug to inspect."}},"required":["slug"]}'::jsonb,
    true, NOW(), NOW()
  ),
  (
    gen_random_uuid()::text,
    'list_available_tools',
    'List available tools',
    'List the full catalog of tools, subagents and integrations that could be added to an agent, with usage counts. Read-only.',
    'custom:agent-introspect',
    '{"type":"object","properties":{},"required":[]}'::jsonb,
    true, NOW(), NOW()
  )
ON CONFLICT ("slug") DO UPDATE SET
  "name"        = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "source"      = EXCLUDED."source",
  "inputSchema" = EXCLUDED."inputSchema",
  "enabled"     = true,
  "updatedAt"   = NOW();
