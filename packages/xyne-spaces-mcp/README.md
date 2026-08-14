# Xyne Spaces MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io) server that gives any MCP-capable
agent access to Spaces — search, tickets, messages, channels, users — and to Xyne Claw remote
agents.

It is a plain stdio MCP server with no client-specific dependencies, so it works with Claude
Code, Cursor, Windsurf, Zed, a custom SDK agent, or anything else that speaks MCP.

## Two surfaces, two logins

The tools fall into two groups that authenticate completely independently. This trips people up,
so it is worth stating plainly:

| Tools | Reaches | Authenticates with |
|---|---|---|
| `spaces-*` | Spaces desktop app on `127.0.0.1:49231` | Native consent dialog in the desktop app |
| `claw-*` | Xyne Claw API at `{base}/claw/api/v1` | Device-flow token in `~/.xyne/agent/claw.json` |

Being logged into one says nothing about the other. `spaces-*` needs the desktop app running;
`claw-*` needs `claw-login` (and shares its credential file with the Xyne CLI, so a login in
either covers both).

## Prerequisites

- **Node.js 18+** or **Bun**
- For `spaces-*` tools: the **Spaces Desktop App** must be running — it serves the local agent
  API on `http://127.0.0.1:49231` and holds the session this server borrows. These tools work
  **only on the same machine as a signed-in desktop app** — not headlessly, in CI, or remotely.
- For `claw-*` tools: network access to the Claw API. No desktop app required.

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

### Xyne Claw — remote agents

| Tool | Description |
|------|-------------|
| `claw-login` | Device-flow login; stores a token at `~/.xyne/agent/claw.json` |
| `claw-logout` | Delete the stored Claw token |
| `claw-whoami` | Show the stored Claw login, or report that none exists |
| `claw-list-agents` | List dispatchable agents and their slugs |
| `claw-list-sessions` | List recent runs with session ids and statuses |
| `claw-run-agent` | Dispatch a task to an agent and wait for the result |
| `claw-get-run` | Fetch one run's status and full detail by session id |

`claw-run-agent` blocks while polling (default 300s, with backoff). On timeout the run usually
keeps going — pick it up later with `claw-get-run`. It can also deliver the agent's reply into
Spaces: pass `channelId` (from `spaces-channels`) to post into that channel, or `deliverTo: "dm"`
for your own DM. That is the one place the two surfaces meet.

### Spaces

| Tool | Description |
|------|-------------|
| `spaces-whoami` | **Who you are** — name, email, UserID, WorkspaceID |
| `spaces-search` | Full-text search across messages, tickets, files, channels, users |
| `spaces-memory-search` | Search facts, SOPs, and knowledge base entries |
| `spaces-tickets` | List and filter tickets by status, priority, assignee, etc. |
| `spaces-ticket-detail` | Read one ticket in full, by TicketID or key (JUSPROD-1234) |
| `spaces-update-ticket` | Change status, priority, assignee, stage, title, ETA, or tags |
| `spaces-subtickets` | List a ticket's sub-tickets |
| `spaces-board-stages` | A board's stages in workflow order |
| `spaces-messages` | Read messages in a conversation thread |
| `spaces-message-detail` | Get detailed message info with attachments |
| `spaces-channels` | List channels by visibility and scope type |
| `spaces-conversations` | List threads in a channel — how you get a ConversationID |
| `spaces-create-conversation` | Start a new thread in a channel |
| `spaces-channel-participants` | Who is in a channel, with roles and UserIDs |
| `spaces-add-reaction` / `spaces-remove-reaction` | React to a message |
| `spaces-calls` | List calls — scheduled, active, or past |
| `spaces-canvases` | List canvas documents |
| `spaces-emails` | Emails tied to a conversation or channel |
| `spaces-my-drafts` | Your unsent drafts |
| `spaces-notifications` | Your notifications |
| `spaces-users` | Look up users by name or email |
| `spaces-activity` | Get your activity feed (mentions, replies, assignments) |
| `spaces-projects` | Search and list projects |
| `spaces-boards` | Search and list boards |
| `spaces-send-message` | Reply to an existing conversation thread |
| `spaces-create-ticket` | Create a new ticket |
| `spaces-schedule-call` | Schedule a call |
| `spaces-webfetch` | Fetch external URLs |

**Start with `spaces-whoami`** for anything phrased as "my" or "assigned to me" — no other tool
reveals your own UserID, and the filters need it.

**The id vocabulary matters.** A ChannelID is not a ConversationID is not a TicketID. Channels
contain threads; threads contain messages. `spaces-conversations` is the bridge from a channel to
something you can post into.

### Not available here

These exist in the product but have no REST route — they are Zero catalog mutators, which the
desktop-app proxy cannot reach. They need the `@xyne/spaces-sdk` / `/api/v1` path:

- editing or deleting a message
- marking an activity read
- reading reactions (`spaces-message-detail` does not show them — the reaction model is not on the
  backend's query allowlist)

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
| `SPACES_API_URL` | see note | Base the `spaces-*` tools call |
| `SPACES_AGENT_NAME` | `Xyne Spaces MCP` | Name shown in the Spaces consent dialog |
| `XYNE_CLAW_BASE_URL` | stored config, else `https://spaces.xyne.juspay.net` | Base the `claw-*` tools call |
| `XYNE_AGENT_DIR` | `~/.xyne/agent` | Directory holding `claw.json` |

> **Note:** the `spaces-*` tools speak the desktop app's loopback vocabulary (`/interact`,
> `/search`, `/auth/request`), which exists only on `127.0.0.1:49231` — a deployed host will
> reject those paths. Set `SPACES_API_URL=http://127.0.0.1:49231` unless you know otherwise.
> `claw-*` tools are unaffected; they resolve their own base independently.

## Troubleshooting

### Server not appearing in your client
- Use an absolute path to `dist/index.js` — relative paths resolve against the client's working
  directory, not this one
- Run `npm run build` first; the server runs from `dist/`, not `src/`
- The transport type must be `stdio` for local servers
- In Claude Code specifically, use `claude mcp add` rather than editing settings by hand. MCP
  config lives in `~/.claude.json`, not `~/.claude/settings.json`. Verify with `claude mcp list`.

### "Authorization was not approved" (`spaces-*`)
- Make sure the Spaces desktop app is running
- Check that the approval dialog appeared and you clicked "Allow"

### "Not authorized for Claw" / "Not logged in to Claw" (`claw-*`)
- Run `claw-login` — this is a separate credential from the Spaces desktop session
- Check `claw-whoami` to see what is currently stored
- The token is shared with the Xyne CLI, so `xyne login` works too

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
