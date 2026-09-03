# xyne-spaces-mcp

An MCP server that lets a coding agent read and write Xyne Spaces — channels, threads,
messages, tickets, calls, canvases and search — through
[`@xyne/spaces-sdk`](../xyne-spaces-sdk), using the same credential the SDK takes.

33 tools over the Spaces public API. Not 483: the SDK exposes every operation the
product itself performs, and this exposes the ones an agent actually reaches for, each
with an exact schema.

---

## Quick start

**1. Mint a key.** Spaces dashboard → **Apps** → **API keys** → *Create key*, choosing a
lifetime of 30, 60, or 90 days. The key is shown once, and you may hold two live keys at
a time. An `xyne_sso_` token from the SDK's device flow works here too — see
[SSO.md](../xyne-spaces-sdk/SSO.md) — though at its current one-day lifetime a minted
key is the better fit for a long-running server.

**2. Tell the server about it.** Either an environment variable:

```bash
export XYNE_SPACES_API_KEY="xyne_sk_…"
export XYNE_SPACES_BASE_URL="https://spaces.xyne.juspay.net"   # optional; this is the default
export XYNE_SPACES_TIMEOUT_MS=120000                           # optional; this is the default
```

`XYNE_SPACES_TIMEOUT_MS` matters on a large workspace. Several of these operations
return an entire result set in one response — the user directory, a project's tickets —
and the underlying SDK aborts a request that outlives its timeout.

…or a file, which keeps the key out of a committed config:

```jsonc
// ~/.xyne/agent/spaces.json
{
  "baseUrl": "https://spaces.xyne.juspay.net",
  "apiKey": "xyne_sk_…"
}
```

**3. Register the server.**

<details open>
<summary><b>Claude Code</b></summary>

```bash
claude mcp add xyne-spaces -- node /path/to/packages/xyne-spaces-mcp/dist/index.js
```

or in `.mcp.json`:

```json
{
  "mcpServers": {
    "xyne-spaces": {
      "command": "node",
      "args": ["/path/to/packages/xyne-spaces-mcp/dist/index.js"]
    }
  }
}
```
</details>

<details>
<summary><b>Cursor, Windsurf, Zed, Continue, or any other stdio MCP client</b></summary>

The same three fields, in whichever file that client reads. `.mcp.json` in this package
is a copyable sample — replace the placeholder path.

```json
{
  "mcpServers": {
    "xyne-spaces": {
      "command": "node",
      "args": ["/absolute/path/to/packages/xyne-spaces-mcp/dist/index.js"],
      "env": { "XYNE_SPACES_API_KEY": "xyne_sk_…" }
    }
  }
}
```

Use an **absolute** path: the server is launched as a subprocess and its working
directory is the client's, not this package's.
</details>

<details>
<summary><b>Your own agent, via an MCP SDK</b></summary>

Any MCP client library can spawn it directly — there is nothing to special-case:

```python
# Python, modelcontextprotocol SDK
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

params = StdioServerParameters(
    command="node",
    args=["/absolute/path/to/packages/xyne-spaces-mcp/dist/index.js"],
    env={"XYNE_SPACES_API_KEY": "xyne_sk_…"},
)

async with stdio_client(params) as (read, write):
    async with ClientSession(read, write) as session:
        await session.initialize()
        tools = await session.list_tools()
        result = await session.call_tool("spaces_whoami", {})
```
</details>

**4. Check it works.** Ask the agent to run `spaces_whoami`. It should name you, your
workspace, and when the key expires.

### Compatibility

This is a plain **stdio MCP server** with no host-specific code — it works with any MCP
client, not just Claude Code. Concretely:

- **Transport** is stdio over JSON-RPC, the baseline every client implements.
- **Protocol** negotiates whatever the client asks for; verified against `2024-11-05`,
  `2025-03-26`, `2025-06-18` and `2025-11-25`.
- **Capabilities** are `tools` only — no prompts, resources, sampling or roots, so there
  is nothing a client has to support beyond calling a tool.
- **Results are plain text blocks**, the most widely supported content type. There is no
  `structuredContent`, so no client has to understand a second encoding of the same rows.
- **Runtime** is Node 22+. Nothing else is required.

The one thing that differs per client is *how you register the server*, which is the
config above. Claude Code, Cursor, Windsurf, Zed, Continue, and anything built on an MCP
SDK all take the same `command` + `args` + `env` triple in their own config file.

---

## What the key can do

**A key acts as you.** Zero's per-table ACL is folded into every read and every write, so
these tools reach exactly what your Spaces user reaches — no more. A private channel you
are not in does not appear in `spaces_channels_list` and its threads are not readable,
even by id.

Two consequences worth internalising:

- Nothing here is an admin backdoor. If an agent "cannot find" a channel, the answer is
  usually that the acting user is not in it.
- Writes are real and immediate. `spaces_message_send` posts to a live thread that other
  people can see, and there is no undo from this server.

**Read-only mode** removes every write tool from the listing:

```bash
XYNE_SPACES_READONLY=1
```

33 tools become 23. A tool the model cannot see is a tool it cannot decide to use, which
is more reliable than declining after the fact.

---

## Tools

Ids are the currency. Almost every write needs an id that only a read can give you, so
the reads are listed first and each one tells you what it hands the next call.

### Identity and discovery

| Tool | Required | Returns |
|---|---|---|
| `spaces_whoami` | — | Your user id, workspace, org, role, key expiry. **Call this first** in any session that filters or writes by user |
| `spaces_search` | — | Relevance-ranked hits across messages, tickets, channels, files, calls, emails, canvases, people — each carrying the ids to act on it |

`spaces_search` is fuzzy. For an exact channel name use `spaces_channels_list`; for
structured ticket filtering use `spaces_tickets_list`. Its `type` and `apps` values are
validated strictly and are **plural** — a hit labelled `[message]` corresponds to
`type: ["messages"]`.

### Channels and threads

| Tool | Required | Returns |
|---|---|---|
| `spaces_channels_list` | — | Channels you can see: name, scope, visibility, live member count, unread count, ids. The authoritative name → id lookup |
| `spaces_channel_participants` | `channel_id` | Members with user id, email, channel role, join date |
| `spaces_channel_create` | `project_id` | A new channel, or a DM with `scope_type: "DM"` + `dm_user` |
| `spaces_threads_list` | `channel_id` | Recent threads with their opening message, reply count, participants, `conversation_id` |
| `spaces_thread_get` | `conversation_id` | One thread's context |
| `spaces_thread_create` | `channel_id`, `content` | Starts a thread. Returns the new `conversation_id` and `message_id` |

### Messages

| Tool | Required | Returns |
|---|---|---|
| `spaces_messages_list` | `conversation_id` | Messages in a thread, full text, author, attachments, `message_id` |
| `spaces_user_messages` | — | Everything one person wrote, newest first, optionally date-bounded. Omit `user` for your own |
| `spaces_message_send` | `conversation_id`, `content` | Posts a reply. Returns the new `message_id` |
| `spaces_message_update` | `message_id`, `content` | Edits your own message |
| `spaces_message_react` | `message_id`, `emoji` | Adds or removes a reaction. Emoji by **name**, no colons |

`spaces_user_messages` is an exact ordered scan, not a ranking — an empty result genuinely
means they wrote nothing in that window, which repeated searches could never establish.

### Tickets

| Tool | Required | Returns |
|---|---|---|
| `spaces_tickets_list` | `view_mode` | Tickets in one scope, in full detail |
| `spaces_tickets_search` | — | Tickets whose key or title matches. The fastest key → id lookup |
| `spaces_ticket_get` | `ticket_id` | One ticket with tags, role assignments, related tickets, stage requests, RCA |
| `spaces_ticket_activities` | `ticket_id` | Change history: who moved what, when |
| `spaces_ticket_create` | `title`, `description`, `project_id`, `channel_id` | A new ticket. The server allocates the key (`PLAT-1234`) |
| `spaces_ticket_update` | `ticket_id` | Changes fields. Reassign with `assigned_to` |
| `spaces_ticket_transition` | `ticket_id`, `to_stage_name` | Moves a stage, picking the right path for the board |

`view_mode` decides the scope and which companion argument is needed: `my-tickets` needs
none, `project` needs `project_id`, `board` needs `board_id`, `user-tickets` needs
`user_id`, `group-tickets` needs `group_id`. Omitting the companion is refused rather
than silently returning everything.

**Use `spaces_ticket_transition` for stage moves**, not `spaces_ticket_update`. It reads
the board type and applies the target stage's status either way; on `NON_LINEAR` boards it
also runs the form gates and approvals that a plain field write skips.

### Lookups

| Tool | Required | Returns |
|---|---|---|
| `spaces_projects_list` | — | Projects with ids and key prefixes |
| `spaces_board_stages` | `project_id` | Boards **with their stages in workflow order**, in one call |
| `spaces_users_list` | — | People with user ids |

Stage names must match exactly, so read them from `spaces_board_stages` rather than
guessing at "Done" or "In Progress".

### Everything else

| Tool | Required | Returns |
|---|---|---|
| `spaces_notifications_list` | — | Mentions, replies, ticket changes. Narrow with `types`; each row shows its read state and classification |
| `spaces_notifications_mark_read` | `notification_id` | Marks one read |
| `spaces_emails_list` | `channel_id` | Emails in a desk or shared-inbox channel, with bodies |
| `spaces_calls_list` | — | Calls by `scope`: `scheduled`, `active`, or `history` (with recordings, transcripts, AI summaries) |
| `spaces_drafts_list` | — | Your unsent drafts |
| `spaces_canvases_list` | — | Canvases: title, owner, last editor |
| `spaces_canvas_get` | `canvas_id` | A canvas body converted to markdown |
| `spaces_claw_list_agents` | — | Claw agents available to this deployment |
| `spaces_claw_run` | `agent`, `task` | Dispatches a Claw run and waits for the answer |
| `spaces_claw_get_run` | `session_id` | Status and result of a run |

Email channels are excluded from `spaces_channels_list` by default — pass
`include_email_channels` to find one.

---

## Recipes

**Post into a channel by name**

```
spaces_channels_list  { name: "payments" }        → channel_id
spaces_thread_create  { channel_id, content }     → conversation_id, message_id
```

To reply in an existing thread instead:

```
spaces_threads_list   { channel_id }              → conversation_id
spaces_message_send   { conversation_id, content }
```

**File a ticket**

```
spaces_projects_list  { name: "platform" }        → project_id
spaces_board_stages   { project_id }              → board_id + exact stage names
spaces_channels_list  { name: "eng" }             → channel_id
spaces_ticket_create  { title, description, project_id, board_id, channel_id }
```

**Reassign and move a ticket**

```
spaces_tickets_search     { query: "PLAT-1234" }              → ticket_id
spaces_ticket_update      { ticket_id, assigned_to: "someone@company.com" }
spaces_ticket_transition  { ticket_id, to_stage_name: "QA" }
```

`assigned_to` takes an email or a user id — every tool that names a person does.

**Catch up on a person's week**

```
spaces_user_messages  { user: "someone@company.com", after: "2026-08-14T00:00:00Z" }
```

**Triage what needs you**

```
spaces_notifications_list       { types: ["mentioned_user"] }
spaces_messages_list            { conversation_id }        ← from any notification
spaces_notifications_mark_read  { notification_id }
```

---

## Errors

Failures come back as text with the API's stable error code, and the auth cases say what
to do:

```
This API key has expired. Create a new one from the Apps page. Set XYNE_SPACES_API_KEY
to a key minted in the Spaces dashboard, under Apps → API keys. Keys last at most
90 days, and can be revoked from that page.
```

The API speaks five codes, one per status:

| Code | Status | Means |
|---|---|---|
| `validation_failed` | 400 | An argument the server rejects, **or** a business rule refusing the operation (an unsupported stage move). The message says which |
| `unauthenticated` | 401 | No key configured, or it is malformed, expired, or revoked — deliberately indistinguishable |
| `forbidden` | 403 | Your user is not allowed this. Not a bug in the tool |
| `not_found` | 404 | Absent, or invisible to you — deliberately indistinguishable. Also: no operation by that name |
| `internal` | 500 | A server-side failure, including search or Claw being down. Retryable |

The 400 message is written for a person to read, so surface it rather than
retrying. A 500 message is deliberately generic; the detail is server-side.

Anything unexpected carries the server's error code in parentheses. The `request_id` is
no longer surfaced: it is on the HTTP response, and `SdkError` does not carry it
through. Quote the message and the code when reporting a server-side failure.

A key can be revoked at any time from the dashboard, and stops working on its
very next request — the server checks its stored status on every call, not just
its signature. If a key leaks, revoke it; you do not have to wait out its
lifetime.

---

## Also using Claw?

`packages/xyne-claw-mcp` ships its own Claw tools behind a separate device login. If both
servers are installed the model sees two Claw tool sets and may pick the one that is not
authenticated. **Install one or the other.** The three `spaces_claw_*` tools here need no
second login — the Spaces backend relays to Claw with the deployment's own credential.

---

## Development

```bash
npm run build
npm run typecheck
```

Operation names and argument shapes used to be strings this package hand-declared, so
`"ticketDetailsByIdV2"` and a typo compiled identically — which is why there was a
script parsing the backend's `queries.ts` to check them. Calling the SDK makes that a
compile error instead, and the SDK carries its own gate over the whole catalog:

```bash
cd ../xyne-spaces-sdk && npm run verify   # typecheck + coverage + contract-check
```

`npm run coverage` there asserts every one of the backend's catalog operations is either
exposed or excluded with a written reason, and that the arguments each one requires are
the ones the registry sends. That is strictly wider than what this package could check
on its own, which only ever covered the ~30 operations these tools happened to name.

**One thing the old script did that nothing replaces yet:** it verified that the direct
routes (`/me`, `/search`, `/channels`, `/tickets`, `/claw/*`) were still mounted in
`api/sdk/direct.ts`. The SDK's `contract-check` has a `routeBodies()` function that
looks like it does this, but it reads a path that does not exist and is never called —
so route existence is currently unverified. Worth fixing in the SDK.

### Adding a tool

One entry in the relevant `src/tools/*.ts`, exporting a `ToolDef`:

```ts
{
  name: "spaces_thing_list",
  description: "…",                       // long, and directive — this is what decides selection
  inputSchema: { /* JSON Schema, snake_case, with per-field descriptions */ },
  catalog: [{ name: "thingsQueryV2", sends: ["limit", "start"] }],
  write: false,
  async handler(args, client) { … },
}
```

`catalog` and `direct` are what the guard reads, so declare every operation the handler
calls. Mark anything that changes state `write: true` so read-only mode can drop it.

**Output is per tool, not a shared projection.** Read tools emit every column that carries
meaning — what matters about a ticket is not what matters about a channel — and never
truncate a body. Bound the number of rows, never the content of one. `src/render.ts` holds
the shared vocabulary: `toIST`, `cleanText`, `indented`, `paginationFooter`, and the
`Name <email> (id: …)` user label.

### Layout

```
src/
  index.ts        server wiring, dispatch, read-only filter
  config.ts       credential resolution, and building the SDK client
  errors.ts       turning a thrown SdkError into prose a model can act on
  render.ts       formatting vocabulary shared by every renderer
  tools/
    shared.ts     ToolDef, ToolContext, and the user directory (id → name, email → id)
    identity.ts   whoami, search
    channels.ts   threads.ts   messages.ts
    tickets.ts    lookups.ts   comms.ts   claw.ts
```

Two runtime dependencies: `@modelcontextprotocol/sdk` for the protocol, and
`@xyne/spaces-sdk` for every call to Spaces. Nothing here speaks HTTP directly.

That second dependency replaced a hand-written HTTP client plus a build-time script
that re-parsed the backend's `queries.ts` to check the operation names and arguments
this package was sending. The SDK owns both now: an operation name is a typed method,
its arguments are a typed parameter, and the ones Zero's optimistic-write model demands
but no caller would think of — a `messageId`, a `timestamp`, a `start` that must be
explicitly `null` — are filled in by the SDK's registry rather than by each tool.
