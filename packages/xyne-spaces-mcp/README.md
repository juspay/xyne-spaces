# Xyne Spaces MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io) server that gives any MCP-capable
agent access to Spaces — search, tickets, messages, channels, users, and more.

It is a plain stdio MCP server with no client-specific dependencies, so it works with Claude
Code, Cursor, Windsurf, Zed, a custom SDK agent, or anything else that speaks MCP.

## Prerequisites

- **Node.js 18+** or **Bun**
- **Spaces Desktop App** must be running — it serves the local agent API on
  `http://127.0.0.1:49231` and holds the session this server borrows.

Because auth flows through the desktop app, this server runs **only on the same machine as a
signed-in Spaces desktop app**. It cannot be used headlessly, in CI, or from a remote host.

## Installation

```bash
cd packages/xyne-spaces-mcp
npm install
npm run build
```

Or with Bun:
```bash
bun install
bun run build
```

## Configuration

The server is launched over stdio. Every MCP client needs the same two things — a command and
its arguments:

```
command: node
args:    ["/absolute/path/to/packages/xyne-spaces-mcp/dist/index.js"]
```

### Generic MCP client

Most clients accept a JSON config of this shape:

```json
{
  "mcpServers": {
    "spaces": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/packages/xyne-spaces-mcp/dist/index.js"],
      "env": {
        "SPACES_AGENT_NAME": "My Agent"
      }
    }
  }
}
```

Consult your client's documentation for where that file lives.

### Claude Code

```bash
# Add to user config (available in all projects)
claude mcp add -s user -t stdio spaces -- node /path/to/packages/xyne-spaces-mcp/dist/index.js

# Or add to local project only
claude mcp add -s local -t stdio spaces -- node /path/to/packages/xyne-spaces-mcp/dist/index.js
```

Verify the server is connected:
```bash
claude mcp list
# Should show: spaces: ... - ✓ Connected
```

## Authentication Flow

When an agent first calls a Spaces tool:

1. The MCP server sends an auth request to the Spaces desktop app
2. **A native dialog appears in Spaces** asking you to approve the connection
3. Choose a duration: "Allow (5 min)", "Allow (1 hour)", or "Allow (Session)"
4. Once approved, the token is cached in memory for the selected duration

The dialog identifies the caller using `SPACES_AGENT_NAME`. Set it per client so you can tell
which agent is asking; it defaults to `Xyne Spaces MCP`.

## Available Tools

| Tool | Description |
|------|-------------|
| `spaces-search` | Full-text search across messages, tickets, files, channels, users |
| `spaces-memory-search` | Search facts, SOPs, and knowledge base entries |
| `spaces-tickets` | List and filter tickets by status, priority, assignee, etc. |
| `spaces-messages` | Read messages in a conversation thread |
| `spaces-message-detail` | Get detailed message info with reactions/attachments |
| `spaces-channels` | List channels by visibility and scope type |
| `spaces-users` | Look up users by name or email |
| `spaces-activity` | Get your activity feed (mentions, replies, assignments) |
| `spaces-projects` | Search and list projects |
| `spaces-boards` | Search and list boards |
| `spaces-send-message` | Send a message to a conversation |
| `spaces-create-ticket` | Create a new ticket |
| `spaces-schedule-call` | Schedule a call |
| `spaces-webfetch` | Fetch external URLs |

Note: `spaces-webfetch` is provided for clients with no fetch capability of their own. If your
client ships a built-in web fetch tool, prefer that one.

## Example Prompts

```
> Search for tickets assigned to me
> Find messages mentioning "deployment"
> Create a ticket for the bug we discussed
> What's in my activity feed?
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SPACES_API_URL` | `http://127.0.0.1:49231` | Spaces desktop app API URL |
| `SPACES_AGENT_NAME` | `Xyne Spaces MCP` | Name shown in the Spaces consent dialog |

## Troubleshooting

### Server not appearing in your client
- Use an absolute path to `dist/index.js` — relative paths resolve against the client's working
  directory, not this one
- Run `npm run build` first; the server runs from `dist/`, not `src/`
- The transport type must be `stdio` for local servers
- In Claude Code specifically, use `claude mcp add` rather than editing settings by hand. MCP
  config lives in `~/.claude.json`, not `~/.claude/settings.json`. Verify with `claude mcp list`.

### "Authorization was not approved"
- Make sure the Spaces desktop app is running
- Check that the approval dialog appeared and you clicked "Allow"

### "Connection refused"
- The Spaces desktop app must be running on port 49231
- Check if another process is using that port

### Token expired
- Re-run any Spaces tool — a new approval dialog will appear

### Remove the server
Delete its entry from your client's MCP config. In Claude Code:
```bash
claude mcp remove spaces
```
