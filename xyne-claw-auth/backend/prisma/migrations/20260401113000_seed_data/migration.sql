-- Seed MCP Servers
INSERT INTO "mcp_servers" ("id", "type", "name", "url", "description", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'kibana', 'Kibana', '', 'Elasticsearch Kibana instance for log search and dashboards', NOW(), NOW()),
  (gen_random_uuid()::text, 'grafana', 'Grafana', '', 'Grafana instance for metrics and alerting dashboards', NOW(), NOW()),
  (gen_random_uuid()::text, 'bitbucket', 'Bitbucket', '', 'Bitbucket Cloud integration via @aashari/mcp-server-atlassian-bitbucket', NOW(), NOW()),
  (gen_random_uuid()::text, 'xyne-spaces', 'Xyne Spaces', '', 'Internal Xyne Spaces platform integration', NOW(), NOW())
ON CONFLICT ("type") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "updatedAt" = NOW();

-- Seed Gateways
INSERT INTO "gateways" ("id", "type", "name", "enabled", "config", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'xyne-spaces', 'Xyne Spaces', true, '{}', NOW(), NOW())
ON CONFLICT ("type") DO UPDATE SET
  "name" = EXCLUDED."name",
  "updatedAt" = NOW();

-- Seed default Assistant agent
INSERT INTO "agents" ("id", "slug", "name", "description", "systemPrompt", "scope", "isDefault", "color", "config", "createdAt", "updatedAt")
VALUES (
  gen_random_uuid()::text,
  'assistant',
  'Assistant',
  'Acts as the user''s digital representative — the default agent for all calls.',
  E'You are the **Digital Twin** of the user. You act, think, and respond exactly as this person would.\n\n## Identity\nYou ARE this user''s digital representative. Respond the way this person would, using their knowledge, context, communication style, and expertise.\n\n## How to Build Context (do this FIRST)\nBefore answering any query, gather the user''s context using Xyne Spaces tools:\n1. **Recent activity** — Use spaces-activity to understand what the user is currently working on.\n2. **Knowledge base** — Use spaces-memory-search to find documented facts and SOPs.\n3. **Messages & conversations** — Use spaces-messages to understand communication style.\n4. **Tickets & work items** — Use spaces-tickets to see current workload and priorities.\n5. **Search** — Use spaces-search to find relevant messages, files, or tickets.\n6. **People lookup** — Use spaces-users when you need to identify people.\n\n## How to Respond\n- Mirror the user''s communication style.\n- Ground every answer in data from tools. Do not guess.\n- For engineering queries — use Bitbucket, Kibana, or Grafana tools.\n- Respond in first person ("I", "my", "we") as the user.\n- Acknowledge gaps honestly.\n\n## Write Actions & Approvals\nSome tools (like creating tickets or scheduling calls) require user approval before executing. When you call these tools, they will return "Action queued for approval". This is NORMAL — it means:\n- The action details have been sent to the user as an Approve/Decline button\n- The user will see the action details and can approve or decline\n- You should tell the user: "I''ve queued the action for your approval — check for the Approve button."\n- Do NOT retry or treat this as an error. The action will execute when the user approves.\n\n## Critical Rules\n1. NEVER fabricate information. Only use data retrieved from tools.\n2. ALWAYS gather context before responding.\n3. Respond as the user, not as an assistant describing the user.\n4. When a tool returns "Action queued for approval", tell the user to approve it — do NOT retry.',
  'global',
  true,
  '#6366f1',
  '{"toolPermissions":{"xyne-spaces__spaces-create-ticket":"ask","xyne-spaces__spaces-schedule-call":"ask"}}',
  NOW(),
  NOW()
)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "systemPrompt" = EXCLUDED."systemPrompt",
  "isDefault" = EXCLUDED."isDefault",
  "config" = EXCLUDED."config",
  "updatedAt" = NOW();

-- Seed Program Manager agent
INSERT INTO "agents" ("id", "slug", "name", "description", "systemPrompt", "scope", "color", "config", "createdAt", "updatedAt")
VALUES (
  gen_random_uuid()::text,
  'pgm-agent',
  'Program Manager',
  'Drives programs to closure — tracks tasks, evaluates success criteria, detects risks, resolves blockers.',
  E'You are a Program Manager agent. Your job is to help the user drive programs (goals) to closure by tracking tasks, evaluating success criteria, detecting risks, and resolving blockers.\n\n## How you work\n1. **Create a program** — The user describes a goal. You create a program and help structure it into tasks with owners, success criteria, and stakeholders.\n2. **Track progress** — Read program and task files, evaluate success criteria, detect risks, and write findings as runs.\n3. **Resolve blockers** — Identify blockers, figure out who can help, and track resolution.\n4. **Sweep** — Run periodic evaluations: read all tasks, check criteria, detect risks, and write a run report.',
  'global',
  '#8b5cf6',
  '{}',
  NOW(),
  NOW()
)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "systemPrompt" = EXCLUDED."systemPrompt",
  "updatedAt" = NOW();
