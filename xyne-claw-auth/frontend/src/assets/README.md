# Assets

Visual assets for agents, MCP connectors, and bot avatars used across the xyne-claw-auth frontend.

## Directory layout

```
src/assets/
├── agents/          # One SVG per agent slug  (matches Agent.slug in DB)
├── mcp/             # One SVG per MCP type    (matches McpServer.type in DB)
└── bots/            # Generic bot illustrations (fallback / branding)
```

## Naming convention

| Folder    | File name                   | Key source            |
|-----------|-----------------------------|-----------------------|
| `agents/` | `{agent.slug}.svg`          | `agents.slug` (DB)    |
| `mcp/`    | `{mcpServer.type}.svg`      | `mcp_servers.type` (DB)|
| `bots/`   | `bot-{purpose}.svg`         | manual / branding     |

**Always use the exact slug/type string** as the filename so the lookup is deterministic:

```ts
import assistantIcon from "@/assets/agents/assistant.svg";
// or dynamic:
const icon = new URL(`../assets/mcp/${server.type}.svg`, import.meta.url).href;
```

## Current placeholders

### `agents/` (9 files)

| File | Agent | Color |
|------|-------|-------|
| `assistant.svg` | Assistant (Digital Twin) | `#6366f1` |
| `grafana-agent.svg` | Grafana Agent | `#f97316` |
| `rca-agent.svg` | RCA / Genius RCA | `#ef4444` |
| `google-agent.svg` | Google Agent | `#4285f4` |
| `microsoft-agent.svg` | Microsoft Agent | `#0078d4` |
| `research-agent.svg` | Research Agent | `#0ea5e9` |
| `ardra-finops.svg` | Ardra FinOps | `#10b981` |
| `investigation-agent.svg` | Investigation Agent | `#f59e0b` |

### `mcp/` (29 files)

`kibana`, `grafana`, `bitbucket`, `xyne-spaces`, `figma`, `sequentialthinking`,
`juspay-internal-tools`, `google`, `microsoft`, `gmail`, `google-drive`, `github`,
`gitlab`, `slack`, `notion`, `salesforce`, `stripe`, `hubspot`, `mixpanel`,
`amplitude`, `bigquery`, `databricks`, `shopify`, `intercom`, `asana`, `calendly`,
`docusign`, `egnyte`, `jotform`

### `bots/` (3 files)

| File | Purpose |
|------|---------|
| `bot-default.svg` | Generic fallback bot avatar (light theme) |
| `bot-xyne.svg` | Xyne-branded bot avatar (dark theme) |
| `bot-analytics.svg` | Analytics / monitoring bot avatar |

## Swapping in real assets

1. Replace any `.svg` file with the real branded asset — keep the filename identical.
2. PNG/WebP are also fine; update the import extension in the consuming component.
3. Recommended size: **40×40 px** (rendered), export at **2×** (80×80) for retina.

## Where these are currently used (or will be)

- **`MCPPageV3.tsx`** — `ServerIcon` component — currently uses `SERVER_ICONS` emoji map → swap to `<img src={mcpIcon} />` from this folder.
- **`AgentCard.tsx`** / **`AgentList.tsx`** — currently renders a `{color}` circle with first letter → swap to `<img src={agentIcon} />` from this folder.
- **`bots/`** — intended for chat bubble avatars in `MessageBubble.tsx` and loading states.
