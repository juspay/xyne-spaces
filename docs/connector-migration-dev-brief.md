# Connector & migration brief

Short spec for the next set of tool imports into Xyne Spaces. Read this first, then copy an existing flow — do not invent a new architecture.

## What we are building

Spaces is the place teams should **work**: chat, tickets, docs, support, calls.

Some tools people use today should **move into Spaces** (history + ongoing work).
Some tools should only **feed context** (agents can read/write them; the team still lives there).

Your job is the first kind: **bring the other tool’s data into Spaces objects**, with a path for the team to stop using that tool.

## Two kinds of work (do not mix them up)

| Kind | What it does | Copy from |
| --- | --- | --- |
| **Migration** | One-time (or batched) import of history. Preview → map users/fields → import → progress. | Jira / Confluence |
| **Live ingest** | Webhooks or polling. New items keep landing in Spaces after cutover. | Slack / Zoho Desk / Gmail |

A complete cutover usually needs **both**: import the past, then keep syncing until they switch off the old tool.

**MCP in claw-auth is not this work.** MCP lets an agent call Linear/Notion/Intercom. It does not import a workspace. Linear/Notion/Intercom already have MCP — you still need migration + ingest.

## Spaces objects you map into

Everything you import must become one of these. If it does not fit, it is out of scope.

| Other tool has | Lands in Spaces as |
| --- | --- |
| Channel / space / team | Channel |
| Message / thread / DM | Conversation + messages |
| Issue / task / board item | Ticket on a board (in a channel/project) |
| Wiki page / Notion doc | Canvas |
| Support ticket / customer thread | Desk ticket (email or chat thread on a desk channel) |
| Meeting recording / transcript | Call |

Always:

1. Map **users** (email is the join key). Unmapped people must be visible in preview, not silently dropped.
2. Store the **external id** (`ExternalSource` / `ExternalMessage`) so we can dedupe and sync later.
3. Index into Vespa the same way Jira/Slack imports do — search has to work after import.
4. Respect the same **permissions** as native Spaces content.

## Code to copy (in this repo)

Do not start from a blank folder. Pick the closest existing path:

| You are importing | Copy this |
| --- | --- |
| Chat history (channels, threads, DMs) | `apps/backend/src/migration/slack/` and self-serve Slack migration |
| Issues / boards / comments | `apps/backend/src/migration/jira/` + `apps/dashboard/src/routes/JiraMigrationScreen/` |
| Wiki / docs | `apps/backend/src/migration/confluence/` + `apps/dashboard/src/routes/ConfluenceMigrationScreen/` |
| Support tickets (live) | `apps/backend/src/integrations/adapters/zoho/` |
| Support from chat | `apps/backend/src/integrations/adapters/slack-desk/` |
| Mail/calendar live sync | `apps/backend/src/integrations/adapters/google/` and `adapters/microsoft/` |
| How to register a live adapter | `apps/backend/docs/guidelines/integrations/README.md` and `apps/backend/src/integrations/README.md` |

Live adapter shape (already documented):

```
webhook/poll → authenticate → optional preprocess → transform to NormalizedData → sync
```

Endpoint: `POST /api/external-source-sync/:sourceName/ingest`

Credentials go in `ExternalSource.credentials`, encrypted. Never in env for customer tenants.

## Build order

Ship **one tool at a time**, in this order. Each tool is done only when the checklist at the bottom passes.

### Already done — do not rebuild

Slack (chat + desk), Jira, Confluence, Zoho Desk, WhatsApp, Gmail, Microsoft 365 mail/calendar.

### P1 — build these next (this is the actual project)

| # | Tool | Maps to | Closest copy | Notes |
| --- | --- | --- | --- | --- |
| 1 | **Microsoft Teams chat** | Channels, threads, DMs | Slack migration + Microsoft adapter | Mail/calendar already sync. **Chat is the gap.** Do not try to replace Outlook/Excel/SharePoint. |
| 2 | **Linear** | Tickets + boards | Jira migration | MCP already exists. Need workspace import + optional live sync. Issues/comments/projects only — skip Linear cycles extras if they do not map cleanly. |
| 3 | **Notion** | Canvas (and ticket-like DBs if they are actually tasks) | Confluence migration | Pages → canvases. A Notion “database of tasks” → tickets. Do not import random databases as docs. |
| 4 | **Zendesk** | Desk tickets | Zoho Desk adapter + Jira-style preview | Email/chat tickets, comments, requesters. Macros/SLAs can wait. |
| 5 | **Intercom** | Desk tickets | Zoho / Slack-desk | MCP already exists. Need conversation ingest into a desk channel. |

After P1, a tenant can move: HQ (Slack **or** Teams), engineering work (Jira **or** Linear), wiki (Confluence **or** Notion), support queue (Zendesk / Intercom / Zoho).

### P2 — only after P1

| Tool | Maps to | Closest copy |
| --- | --- | --- |
| Asana | Tickets | Jira / Linear |
| Freshdesk | Desk | Zoho / Zendesk |
| Monday.com | Tickets / boards | Jira |
| Zoom + Google Meet | Call recordings/transcripts | Existing Call + meeting-insight path |

Meetings: we do **not** need to kill Zoom/Meet for external calls. Import/index recordings; internal calls can live in Spaces Call.

## What “done” means for one tool

Minimum product, in order:

1. **Auth** — OAuth or token, stored encrypted on `ExternalSource`.
2. **Preview** — show what will be created (channels/tickets/docs/users). Block import if required user map is empty.
3. **Import** — history lands as native Spaces objects, with external ids, attachments, and Vespa index.
4. **Progress / pause / retry** — same job UX as Jira migration.
5. **Live follow-up** — webhooks or poll so new items keep arriving until they cut over.
6. **Idempotent** — running twice does not duplicate threads/tickets.

UI: follow `JiraMigrationScreen` / `ConfluenceMigrationScreen`. Same steps (connect → preview → map → run). Do not design a new wizard unless the data model truly needs it.

## Out of scope (connect only — not your project)

Do **not** build migrations for:

- GitHub / GitLab / Bitbucket (code host stays; Issues can be a later optional sync)
- Salesforce / HubSpot (CRM)
- Figma / Miro (design)
- Google Drive / SharePoint as a file dump (pull a few docs to Canvas if needed; leave the drive)
- Fireflies / Gong (transcripts into Call context only)
- Discord, Google Chat, ClickUp, Trello, ServiceNow

If someone asks for these, the answer is MCP or a later connector — not a cutover.

## If you are stuck

1. Find the closest row in “Code to copy”.
2. List the other tool’s objects → Spaces objects (write it down before coding).
3. Implement preview before import.
4. Ask if a field has no Spaces equivalent — store it in metadata or skip it. Do not add a new Spaces entity for one vendor.
