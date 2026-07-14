# xyne-claw-mcp

Claude Code MCP server and Claude Code plugin for Xyne Claw remote agents.

## Install and build

```bash
cd /Users/anurag.dwivedi/work_dir/xyne-spaces/xyne-claw-mcp
npm install
npm run build
```

## Claude Code plugin

This directory is the plugin root. Load it locally with:

```bash
claude --plugin-dir ./xyne-claw-mcp
```

From inside this directory, use:

```bash
claude --plugin-dir .
```

The plugin structure is:

```text
xyne-claw-mcp/
├── .claude-plugin/
│   └── plugin.json
├── .mcp.json
├── dist/
│   └── index.js
└── skills/
    ├── agents/SKILL.md
    ├── login/SKILL.md
    ├── run/SKILL.md
    ├── sessions/SKILL.md
    └── whoami/SKILL.md
```

Only `.claude-plugin/plugin.json` lives under `.claude-plugin/`. The MCP config and skills are at the plugin root so Claude Code discovers them as plugin components.

`.mcp.json` registers the bundled MCP server with:

```json
{
  "mcpServers": {
    "xyne-claw": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/dist/index.js"],
      "env": {
        "XYNE_CLAW_BASE_URL": "${XYNE_CLAW_BASE_URL}"
      }
    }
  }
}
```

Plugin commands:

- `/xyne-claw:login` - log in with the device flow.
- `/xyne-claw:agents` - list available Claw agents.
- `/xyne-claw:sessions` - list recent Claw sessions.
- `/xyne-claw:run <agent-slug> <task...>` - run a remote Claw agent.
- `/xyne-claw:whoami` - show the current Claw auth identity.

The server stores and reads the shared Claw token at `~/.xyne/agent/claw.json`, matching the Xyne CLI/plugin convention. Logging in from either side can be reused by the other.

The production Claw backend must have `CLI_TOKENS_ENABLED=on` so `/cli/auth/start` and `/cli/auth/token` can mint CLI tokens.

## MCP server only

If you only want the MCP server without the plugin wrapper, add it directly to Claude Code:

```bash
claude mcp add xyne-claw -- node /Users/anurag.dwivedi/work_dir/xyne-spaces/xyne-claw-mcp/dist/index.js
```

The server uses stdio transport and `@modelcontextprotocol/sdk`. It defaults to:

- Base URL: `https://app.spaces.xyne.juspay.net`
- API path: `/claw/api/v1`
- Token file: `~/.xyne/agent/claw.json`

Set `XYNE_CLAW_BASE_URL` to point at another Claw server.

## Tools

`claw_login`

Starts the device-flow login with `POST /cli/auth/start`, shows a verification URL and user code, polls `POST /cli/auth/token`, and writes `~/.xyne/agent/claw.json` when authorized.

Example:

```json
{ "timeout_seconds": 600 }
```

`claw_logout`

Deletes the stored Claw token.

Example:

```json
{}
```

`claw_whoami`

Shows the stored login email, user id, base URL, and token path, or reports that no login is stored.

Example:

```json
{}
```

`claw_list_agents`

Lists available Claw agents with slug, name, and description. Requires a stored token.

Example:

```json
{}
```

`claw_list_sessions`

Lists recent Claw sessions/runs from `GET /runs/light?limit=...`. Requires a stored token.

Example:

```json
{ "limit": 20 }
```

`claw_run_agent`

Runs an agent with `POST /run` using `{ "agentSlug": "...", "task": "...", "triggerSource": "api" }`, then polls `GET /runs/:sessionId` until a terminal status: `completed`, `failed`, `cancelled`, `canceled`, or `error`. Immediate `404` statuses are treated as not-yet-persisted and retried.

Example:

```json
{
  "agent": "assistant",
  "task": "Summarize my latest Claw sessions",
  "timeout_seconds": 300
}
```

`claw_get_run`

Fetches one run status/result with `GET /runs/:sessionId`.

Example:

```json
{ "session_id": "SESSION_ID_HERE" }
```
