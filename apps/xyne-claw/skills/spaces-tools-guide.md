---
name: spaces-tools-guide
description: Complete reference for calling Xyne Spaces tools correctly — per-tool argument schemas, required vs optional fields, defaults, enum values, ID-vs-name pitfalls, attached-context handling, iteration strategy, and when to delegate to the `spaces` subagent. Load before firing any spaces-* tool. Skim the tool picker first; jump to the per-tool section for exact args.
---

# Calling Spaces tools correctly

Most wrong answers come from one of three failures:

1. Picking the wrong tool (e.g. `spaces-search` for tickets).
2. Forgetting to scope (no `channelId`, no `conversationId`).
3. Passing a name or email where the tool wants an ID — or worse, inventing an ID.

This skill is the antidote. Skim the picker. Jump to the per-tool section before firing a call. If a tool wants a `cm…`-shaped ID and you don't have one, resolve it first — one extra `spaces-users` / `spaces-channels` / `spaces-projects` call is cheaper than a wrong answer.

## Two paths — pick well

**Path 1 — direct tool call.** Use when the lookup is narrow and you know roughly what you're after. "List open P0 tickets in #payments." → `spaces-tickets`. "Find the user named Sarah." → `spaces-users`. Faster, fewer round-trips, full args under your control.

**Path 2 — delegate to the `spaces` subagent.** Use when the question is fuzzy, open-ended, or needs several searches stitched together. "What's the history of how we moved off the monolith?" → spaces subagent. Always tell the subagent to return citation tokens, and carry the exact tokens it returns into your answer.

For multi-part user tasks, mix — do simple parts yourself, farm deep sub-queries to the subagent (even several in parallel).

## Tool picker

| If the user is asking about… | Use |
|---|---|
| Who am I / what's my user ID | `spaces-whoami` |
| Resolving a person's name → ID | `spaces-users` |
| A specific topic/keyword across messages, files, tickets | `spaces-search` |
| Tickets — status, assignee, priority, board, stage, dates | `spaces-tickets` — NOT spaces-search |
| Desk metrics — response/resolution times, CSAT, ticket volumes, per-agent/priority/stage/tag breakdowns, opened-vs-closed trends | `spaces-desk-metrics` — NOT spaces-tickets |
| Reading a specific thread | `spaces-messages` |
| One message's reactions / attachments / metadata | `spaces-message-detail` |
| Finding a channel | `spaces-channels` |
| What's waiting on me / mentions / assignments | `spaces-activity` |
| Projects | `spaces-projects` |
| Who's on a project team | `spaces-project-team-members` |
| Boards (for ticket creation) | `spaces-boards` |
| Finding a doc | `spaces-canvases` |
| Reading a doc's contents | `spaces-read-canvas` |
| A call/meeting list — titles/times/status | `spaces-calls` |
| Meeting/call content — decisions, action items, what someone said | `spaces-meeting-insights` — NOT spaces-search |
| Email threads on a desk ticket | `spaces-emails` |
| Files on a thread | `spaces-thread-attachments`, then `spaces-fetch-attachment` |
| Automation run counts / success rates | `spaces-workflow-stats` |
| My drafts / scheduled sends / bookmarks / pinned threads | `spaces-my-items` |
| "How/why do we…", SOPs, policies, verified facts | `memory-search` **first** |
| Creating a ticket | `spaces-create-ticket` (write) |
| Updating a ticket | `spaces-update-ticket` (write) |
| Scheduling a meeting | `spaces-schedule-call` (write) |
| Posting in a different thread/channel as the user | `user-send-message` (write) |
| Creating a canvas | `spaces-create-canvas` (write) |
| Editing a canvas | `spaces-edit-canvas` (write) |

## Filter parity — the tools mirror the dashboard

Each read tool now exposes (nearly) the same filters the matching Spaces dashboard screen offers, so if a user describes a filtered view they'd build in the UI, there's almost always a direct arg for it. Some quick mappings:

- "Tickets where **Priya is the PR reviewer**" → `spaces-tickets { prReviewers: ["priya@…"] }` (also `qaAssigned`, `userGroupIds`, `ticketTypes`, `aiCategory`, `dueAfter`/`dueBefore`).
- "**Overdue** HIGH/CRITICAL tickets" → `spaces-tickets { priorityIn: ["HIGH","CRITICAL"], dueBefore: "<now>" }`.
- "Members of the **payments on-call group**" → `spaces-users { groupId: "<id>" }`.
- "Calls **I attended** last week" → `spaces-calls { participantId: "<myId>", after: "<start>", before: "<end>" }`.
- "Canvases **I starred**, excluding auto-generated docs" → `spaces-canvases { starredOnly: true, excludeCallGenerated: true }`.
- "My **mentions** this feed" → `spaces-activity { tab: "your_mentions" }`.
- "My **email drafts in #support**" → `spaces-my-items { type: "email-drafts", channelId: "<id>" }`.

Most people-filters (`assignedToIn`, `createdByIn`, `prReviewers`, `qaAssigned`) accept an **email or a userID** — mix freely; no pre-resolve needed. Every array filter matches ANY of its values (OR); different filters AND together.

## ID types — pay attention

Tools fail silently or return junk if you pass the wrong kind of ID. Here's the canonical reference:

| Field | Expects | How to get it |
|---|---|---|
| `channelId` | channel ID | `spaces-channels` by name, or attached context |
| `conversationId` | thread / DM / ticket-thread ID | from `spaces-tickets`, `spaces-activity`, `spaces-channels`, attached context |
| `messageId` | individual message ID | from `spaces-messages` or `spaces-activity` |
| `userId` (from, assignee, createdBy, organizerId, …) | user ID, shape `cm…` | `spaces-users` by name/email, or `spaces-whoami` |
| `projectId` | project ID | `spaces-projects` |
| `boardId` | board ID | `spaces-boards` |
| `ticketId` | **Internal ID**, not Xyne ID | `spaces-tickets` — use the field labeled "Internal ID" |
| `viewAccessId` (canvas) | the ID from the canvas URL `/chat/canvas/<viewAccessId>` | `spaces-canvases` |
| `attachmentId` | attachment ID | `spaces-thread-attachments` |

A few tools accept **either** an ID **or** an email — they resolve server-side: `spaces-tickets`'s `assignedTo`, `createdBy`, `createdByIn[]`, `assignedToIn[]`, `prReviewers[]`, `qaAssigned[]`. Everywhere else (`from`, `organizerId`, `participantId`, `spaces-users`'s `groupId`, canvas `createdBy`, …), resolve to an ID first.

## Attached context — when the user attaches items

When the user attaches a channel/thread/ticket/canvas/call to their message, a "# Attached context" block appears in your context. The user's query is **about those items** — even a vague "summarize", "what's this", "tldr", "recap" means "scoped to the attached thing". Never respond as if no context was attached.

Always pass the attached IDs explicitly:

- **Channel** attached → `channelId=<id>` for `spaces-tickets` / `spaces-activity` / `spaces-canvases` / `spaces-calls`; `in=<id>` for `spaces-search`.
- **Thread** attached → `conversationId=<tid>` for `spaces-messages` / `spaces-emails` / `spaces-thread-attachments`.
- **Ticket** attached → read its `conversationId` with `spaces-messages`; narrow further with `spaces-tickets` if the user asks about related work.
- **Canvas** attached → `spaces-read-canvas` with its `viewAccessId` **before** answering.
- **Call** attached → use its `conversationId` for messages; `spaces-meeting-insights` for content.

The backend may auto-fill missing IDs, but pass them explicitly — your reasoning is cleaner and traces read correctly.

## Iterating — don't stop at the first hit

After every tool result, ask yourself: *"Does this fully and unambiguously answer the question, or does it just look related?"*

- Not enough? Refine — different keywords, tighter filters, a different tool, or hand the whole sub-question to the spaces subagent.
- Cross-check important claims from a second angle before stating them as fact.
- Run independent lookups in parallel when a question spans multiple data sources.

The org is full of look-alike content. Stay anchored to **exactly** what was asked. Don't drift into adjacent topics just because the search surfaced them.

---

# Per-tool argument reference

Read the section for the tool you're about to call. Every `Required` line is enforced — calls without those fields error out.

---

## spaces-whoami

Returns the current user's profile — `userId`, `name`, `email`, `workspaceId`. Call this when you need the caller's own ID for filters like `assignedTo`, `from`, `createdBy`.

**Required:** none.

**Args:** none.

---

## spaces-users

Look up users by name or email, **or list the members of a user group (team)**. Returns `userId`, name, email, type, status.

**Required:** `nameOrEmail` **or** `groupId` (at least one).

**Args:**

- **nameOrEmail** (string) — Name (no `@`/`.`) for name search, or email (contains `@` or `.`) for email search. The tool auto-detects. Optional when `groupId` is given.
- **groupId** (string) — List members of this user group. Use alone to enumerate a team, or with `nameOrEmail`/`status` to narrow within it.
- **status** (string, enum: `ACTIVE | INACTIVE`) — Filter by account status. **Omit to include departed/deactivated users** (they surface tagged with their status + left date — the "did this person leave?" case); set `ACTIVE` for current members only.
- **orderBy** (string, enum: `name | createdAt | lastActiveAt`) — Sort field. Omit for default relevance order.
- **sortOrder** (string, enum: `asc | desc`, default `asc`) — Direction for `orderBy`.
- **limit** (number, 1–100, default 100) — Max results.
- **offset** (number, ≥0, default 0) — Pagination.

**Notes:**

- Departed/deactivated users are **included by default** (tagged) — set `status=ACTIVE` to hide them.
- For name/email search, results aren't sorted by relevance — if the first hit isn't the right person, scan the rest, or set `orderBy`.
- Always call this **before** `spaces-tickets`, `spaces-search`, `spaces-create-ticket`, `spaces-schedule-call` when you need a `userId` from a name.

**When to use `groupId`:** the user names a team/on-call group and asks who's in it, or asks for that team's tickets — resolve the group's members here, then feed the userIDs into `spaces-tickets` (`assignedToIn`/`createdByIn`). You need the group's ID first (from the ticket/user-group context or a prior lookup); `spaces-users` filters by group **ID**, not name.

**Example — a team roster:**
- `spaces-users { groupId: "grp_payments_oncall", status: "ACTIVE" }` → the current on-call roster.

---

## spaces-search

Fast Vespa-powered search across messages, tickets, files, channels, users. Use it for keyword/topic/person lookups. **Not** the tool for structured ticket queries — use `spaces-tickets` for those.

**Required:** `query` (unless `filterOnly=true`).

**Args:**

- **query** (string) — Search query text. Can be empty when `filterOnly=true`.
- **type** (string) — Narrow to one surface: `messages | attachments | channels | tickets | files`. **Set this** — without it, results are grouped across surfaces and you get noise.
- **in** (string) — Channel ID(s) to scope into, comma-separated. **ALWAYS set this when the user is asking about a specific channel or has a channel attached as context.**
- **from** (string) — Filter by sender userID(s), comma-separated. Resolve names via `spaces-users` first. **NOT email, NOT name.**
- **apps** (string) — Comma-separated apps: `chat, ticket, user, file` (default: all). Prefer `type` over this.
- **status** (string) — Comma-separated ticket statuses. Prefer `spaces-tickets`.
- **priority** (string, enum: `HIGH | MEDIUM | LOW | CRITICAL`) — Ticket priority. Prefer `spaces-tickets`.
- **board** (string) — Board name. Prefer `spaces-tickets`.
- **stage** (string) — Ticket stage. Prefer `spaces-tickets`.
- **assignee** (string) — Assigned userID. Prefer `spaces-tickets`.
- **tags** (string) — Comma-separated tags.
- **before** (string) — Created before — ISO 8601 or `15 Mar 26`. Prefer `range`.
- **after** (string) — Created after — ISO 8601 or `15 Mar 26`. Prefer `range`.
- **range** (string) — Natural window: `today | yesterday | this week | last 7 days | last 30 days`.
- **limit** (number, 1–100, default 100) — Page size. In the default grouped mode each surface is capped at a fixed 10 regardless of this; `limit` only acts as a real page size once you narrow to a single `type` (ungrouped) or page with `offset`.
- **offset** (number, ≥0, default 0) — Pagination offset. Setting `offset>0` drops grouping and returns a flat ranked list.

**Common mistakes:**

- No `in=` when scoped to a channel → global noise. (Note: `in` does NOT scope file results — see `spaces-vespa-schema`.)
- No `type=` → results grouped across surfaces and capped at 10 each; pass `type` to go flat and get real counts.
- `from=sarah@…` → wrong — pass userID. `from` means authored-by (sender/creator), not assignee.
- Counting visible rows of a grouped result → undercount; narrow to one `type` and read "Found N" / paginate.

**Worked examples — diverge, converge, re-query.**

The move: turn the intent into a few **divergent** angles, fire them **in parallel in one turn**, then let what comes back **converge** you onto the exact channel/thread/ticket/person — re-query once with that real handle, then **fetch the full source** before answering. (Philosophy: `ask-ai-first-principles`. Engine internals: `spaces-vespa-schema`.)

*1 — Open-ended status → diverge across angles, converge on the live thread.*
User: "How's the Apollo migration going?"
- Diverge (one turn, parallel — the asker's sentence is never the query):
  - `spaces-search { query: "Apollo migration status", type: "messages" }`
  - `spaces-search { query: "Apollo cutover blockers", type: "messages" }`
  - `spaces-search { query: "Apollo migration", type: "tickets" }`
- Results surface `#apollo-billing`, a hot thread (`conversationId: cm_t1`), and an in-progress ticket (`xyneId: APL-42`).
- Converge — read the real sources, never answer from the snippet:
  - `spaces-messages { conversationId: "cm_t1" }` + `spaces-tickets { … }` then `spaces-messages` on the ticket's thread. Cite the chunks.

*2 — Re-query on a prior result: name → userID → `from`.*
User: "What has Priya raised about refund failures?"
- `from` takes a userID, never a name — resolve first:
  - `spaces-users { nameOrEmail: "Priya" }` → `userId: cm_u9`
- Then the authored-by search:
  - `spaces-search { query: "refund failures", from: "cm_u9", type: "messages" }` → open the top hit's `conversationId` with `spaces-messages`.

*3 — Re-query on a prior result: surfaced channel → scope with `in`.*
User: "What's the latest on the checkout outage?"
- Diverge globally first: `spaces-search { query: "checkout outage", type: "messages" }`
- Hits cluster in a channel called `#checkout-incidents`. Converge by scoping into it:
  - `spaces-channels { name: "checkout-incidents" }` → `channelId: cm_c3`
  - `spaces-search { query: "checkout outage root cause", type: "messages", in: "cm_c3", range: "last 7 days" }`
- (`in` cuts cross-channel noise — but it does **not** scope `type=files`; see `spaces-vespa-schema`.)

*4 — Converge by surface to COUNT a concept that spans surfaces.*
User: "How many onboarding issues came up this month?"
- "Issues" = tickets AND in-channel reports. Count each surface, never tally a grouped page:
  - `spaces-tickets { tags: "onboarding", createdAfter: "<month-start>", summary: true }` (exact ticket count)
  - `spaces-search { query: "onboarding issue", type: "messages", range: "last 30 days" }` → read "Found N", `offset`-paginate to exhaustion.
- Sum, and report both numbers with their source.

*5 — Empty result → widen, then re-narrow (don't conclude "none").*
User: "Did anyone mention the SOC2 audit in #security last week?"
- `spaces-search { query: "SOC2 audit", type: "messages", in: "cm_sec", range: "last 7 days" }` → empty.
- Empty under a filter is ambiguous. Drop the time window first:
  - `spaces-search { query: "SOC2 audit", type: "messages", in: "cm_sec" }` → hits from ~3 weeks ago.
- Now answer truthfully: nothing *last week*, but there was discussion on `<date>` — with the source.

*6 — Filter-only browse (no query text).*
User: "Show me the latest files shared in #design."
- Omit `query` entirely → filter-only mode:
  - `spaces-search { type: "attachments", in: "cm_design", range: "last 7 days" }`
- (`type: "attachments"` is channel-scoped; `type: "files"` would ignore `in`.)

---

## spaces-tickets

**The** tool for ticket LOOKUPS — lists, status, assignee, board, stage, dates. Returns structured rows including `conversationId` (use with `spaces-messages` to read the thread).

**Not** the tool for support-desk metrics. Response/resolution times, CSAT, ticket volumes, per-agent performance, priority/stage/tag breakdowns and opened-vs-closed trends belong to `spaces-desk-metrics`, which aggregates them in the database across the whole desk. Rule of thumb: reach here when the asker wants the TICKETS, reach there when they want a NUMBER about the desk.

**Required:** none — all filters optional.

**Args:**

- **status** (string, enum: `TODO | STARTED | PAUSED | CANCELLED | COMPLETED`) — Filter by status.
- **priority** (string, enum: `LOW | MEDIUM | HIGH | CRITICAL`) — Filter by priority.
- **assignedTo** (string) — Accepts userID **OR email** — resolved server-side.
- **createdBy** (string) — Accepts userID **OR email** — resolved server-side.
- **createdByIn** (array of strings) — Bulk: array of emails/userIDs (mix allowed). Use for team reports — one call instead of N. **If set, `createdBy` is ignored.** Unresolved emails are surfaced in the response.
- **boardId** (string) — From `spaces-boards`.
- **projectId** (string) — From `spaces-projects`.
- **stageName** (string) — Exact stage name.
- **tags** (string) — Comma-separated tag names.
- **channelId** (string) — Restrict to one channel.
- **createdAfter** (string) — ISO 8601, e.g. `2026-04-20T00:00:00Z`.
- **createdBefore** (string) — ISO 8601.
- **limit** (number, 1–500, default 20) — Bump high for team reports.
- **offset** (number, ≥0, default 0) — Pagination.
- **classifyActionable** (boolean) — When `true`, server tags each ticket with `actionReason` ∈ `critical | overdue | no-assignee | stale | null`. Use for daily reports / triage. Never classify tickets yourself — it does it wrong.
- **summary** (boolean) — When `true`, appends aggregate counts: `total`, `byStatus`, `byPriority`, `byUser`. Lets you skip arithmetic for reports. **Page-bounded — read this before trusting it:** the counts cover only the rows THIS call returned (`limit`, default 20, max 500), not everything that matched your filters. They answer "of the tickets I pulled, how many are HIGH?" — never "how many did the desk get?". For desk-wide totals, averages, CSAT or trends use `spaces-desk-metrics`, which aggregates in the database with no page cap.
- **expectedUserGroup** (array of strings) — Emails/userIDs you expected to see. Combined with `summary=true`, the summary's `byUser` keeps members with 0 tickets — so you can show "Members with No Tickets" without doing set difference yourself.

**Multi-select & UI-parity filters** (these mirror the dashboard's ticket filters — each array matches ANY of its values):

- **statusIn** (array, enum values as `status`) — Multiple statuses. Multi-select form of `status`; overrides `status` when both set.
- **priorityIn** (array, enum values as `priority`) — Multiple priorities.
- **boardIdIn** (array) / **stageNameIn** (array) — Multiple boards / stages.
- **assignedToIn** (array of emails/userIDs) — Assignee across many users (strict assignee match — unlike singular `assignedTo`, it does NOT also match creator). If set, singular `assignedTo` is ignored.
- **userGroupIds** (array) — Owning user-group ID(s).
- **ticketTypes** (array) — Ticket type(s), e.g. `Bug`, `Feature`.
- **aiCategory** (array) — AI-classified category label(s), e.g. `Mandate`, `Refund`.
- **prReviewers** (array of emails/userIDs) — Tickets where ANY of these users is a **PR reviewer**.
- **qaAssigned** (array of emails/userIDs) — Tickets where ANY of these users is **QA-assigned**.
- **dueAfter** / **dueBefore** (string, ISO 8601) — Due-date (ETA) range.
- **orderBy** (string, enum: `updatedAt | createdAt`, default `updatedAt`) / **sortOrder** (`desc | asc`, default `desc`).

**Worked examples:**
- Team's open tickets, newest first: `spaces-tickets { createdByIn: ["a@x","b@x"], statusIn: ["TODO","STARTED"], orderBy: "createdAt", sortOrder: "desc" }`.
- Overdue high-priority: `spaces-tickets { priorityIn: ["HIGH","CRITICAL"], dueBefore: "<now-ISO>", statusIn: ["TODO","STARTED","PAUSED"] }`.
- Awaiting a reviewer's PR review: `spaces-tickets { prReviewers: ["reviewer@x"], stageNameIn: ["PR Review"] }`.
- Refund-category bugs on a board: `spaces-tickets { aiCategory: ["Refund"], ticketTypes: ["Bug"], boardId: "<id>" }`.

**Notes:**

- When singular `assignedTo` is set without `createdBy`/`createdByIn`, the tool returns tickets assigned to AND created by that user, deduped — covers both "their queue" and "what they opened" in one call. (Use `assignedToIn` for a strict assignee-only match across several people.)
- `COMPLETED` / `CANCELLED` are never tagged actionable even if old.
- The `summary` block renders FIRST in the response so it survives truncation.

**Common mistakes:**

- Manually counting tickets when `summary=true` would have done it for you.
- Calling once per team member instead of using `createdByIn=[...]`.
- Trying to classify "is this actionable?" yourself — use `classifyActionable=true`.

---

## spaces-messages

Read messages in a thread. Returns chronological list.

**Required:** `conversationId`.

**Args:**

- **conversationId** (string, required) — From `spaces-tickets`, `spaces-activity`, attached context, or a channel. **NOT** the channelId, **NOT** the ticketId.
- **limit** (number, 1–100, default 30) — Max messages.
- **offset** (number, ≥0, default 0) — Pagination.
- **sortOrder** (string, enum: `asc | desc`, default `asc`) — `asc` = oldest→newest (normal reading); `desc` + a small `limit` grabs the latest replies.
- **hasAttachment** (boolean) — Only messages that carry a file (the thread "Files" view).
- **msgType** (array, enum: `USER | BOT | SYSTEM | FORWARDED`) — Restrict by type. `USER` = human replies; `BOT`/`SYSTEM` = automation & workflow posts (the "Workflows" view); `FORWARDED` = forwarded messages.

**Notes:**

- Only `senderId` is shown (gateway strips relations) — pair with `spaces-users` if you need a display name.
- Filtered to non-deleted messages.
- To read only the automation/workflow chatter in a busy thread: `spaces-messages { conversationId: "<id>", msgType: ["BOT","SYSTEM"] }`.

---

## spaces-message-detail

Full detail on one message — content, sender, reactions with counts, attachments.

**Required:** `messageId`.

**Args:**

- **messageId** (string, required) — From `spaces-messages` or `spaces-activity` results.

**Notes:** Same `senderId`-only limitation as `spaces-messages`.

---

## spaces-channels

List channels. Filter by name, visibility, scope type, participant.

**Required:** none.

**Args:**

- **name** (string) — Case-insensitive partial match. Use this to find a channel by name like `payments` or `apollo`.
- **description** (string) — Case-insensitive partial match on the channel description/topic (a channel's purpose text, which `name` doesn't reach).
- **visibility** (string, enum: `PUBLIC | PRIVATE`) — Filter by visibility.
- **scopeType** (string, enum: `DEFAULT | DM | TICKET | DOCUMENT | GROUP_DM`) — Filter by scope. Use `DM` to find direct messages, `GROUP_DM` for group DMs.
- **channelType** (string, enum: `DEFAULT | EMAIL | SUPPORT | SLACK | APP`) — Filter by channel **type** (distinct from `scopeType`). `DEFAULT` = regular chat channels (what the chat directory shows); `EMAIL`/`SUPPORT`/`SLACK`/`APP` = desk / integration channels. Set `DEFAULT` to exclude desk channels from a channel list.
- **participantName** (string) — Partial match on participant name. Combine with `scopeType=DM` to find a DM with a specific person.
- **orderBy** (string, enum: `lastActivityAt | createdAt | name`, default `lastActivityAt`) / **sortOrder** (`desc | asc`) — For `name`, `asc` = A→Z.
- **includeMembers** (boolean, default false) — List member NAMES, not just the count. Off by default (a busy channel has hundreds); page with `membersLimit` / `membersOffset`. Narrow to one channel first.
- **limit** (number, 1–100, default 100) — Max channels.

**Notes:** Default sort is `lastActivityAt` descending — most recent first. `channelType` is often what you want when a user says "regular channels only" — it hides desk/email/integration channels that `scopeType` wouldn't.

---

## spaces-activity

Your activity feed — mentions, replies, assignments, notifications. Each row carries `messageId`, `conversationId`, `ticketId`, `channelId` so you can drill in.

**Required:** none.

**Args:**

- **tab** (string, enum: `your_mentions | replies | reactions | group_mentions | tickets | canvas`) — Filter to one feed tab, exactly like the dashboard. `tickets` = all ticket-lifecycle activity (assignments, status/stage/PR/RCA/approval events); `canvas` = canvas shares/access changes + canvas mentions.
- **actorActions** (array) — Advanced: raw activity action types, e.g. `["ticket_assigned","ticket_status"]`. Overrides `tab` when both set. Prefer `tab` for the common groupings.
- **classification** (string) — e.g. `ACTIONABLE`, `FYI`, `PENDING`.
- **unreadOnly** (boolean) — Only unread.
- **sortOrder** (string, enum: `desc | asc`, default `desc`) — Newest first by default.
- **limit** (number, 1–100, default 100) — Max entries.
- **offset** (number, ≥0, default 0) — Pagination.

**Notes:**

- Scoped to the caller automatically — no `userId` arg.
- "What's assigned to me / changed on my tickets?" → `spaces-activity { tab: "tickets", unreadOnly: true }`. "Where was I @-mentioned?" → `{ tab: "your_mentions" }`.

---

## spaces-projects

Find project IDs (needed for `spaces-create-ticket`).

**Required:** none.

**Args:**

- **search** (string) — Case-insensitive partial match on the project **name OR its code/shortcode** (e.g. `EUL`). Look a project up by either — the result shows the code in `[brackets]`.
- **limit** (number, 1–100, default 100).
- **offset** (number, ≥0, default 0).

**Notes:** Sorted by `createdAt` desc. If a user references a project by its shortcode (like "the EUL project"), just pass it as `search` — no need to know whether it's a name or a code.

---

## spaces-project-team-members

All unique team members across every channel in a project. Returns userIDs + names + emails.

**Required:** `projectId`.

**Args:**

- **projectId** (string, required) — From `spaces-projects`.

**Notes:** Aggregates up to 200 channels × 1000 participants and dedupes — fine for normal orgs.

---

## spaces-boards

Find board IDs (needed for `spaces-create-ticket`).

**Required:** none.

**Args:**

- **search** (string) — Partial board name match.
- **projectId** (string) — Restrict to one project.
- **limit** (number, 1–50, default 20).
- **offset** (number, ≥0, default 0).

---

## spaces-canvases

Search/list canvas docs.

**Required:** none.

**Args:**

- **search** (string) — Title partial match (case-insensitive).
- **channelId** (string) — Restrict to one channel.
- **projectId** (string) — Restrict to one project.
- **folderId** (string) — Restrict to one folder. Pass the literal `"none"` for ungrouped/personal canvases.
- **visibility** (string, enum: `PUBLIC | PRIVATE`).
- **createdBy** (string) — Creator userID.
- **starredOnly** (boolean) — Only canvases you've starred.
- **excludeCallGenerated** (boolean, default false) — Hide auto-generated RCA/PRD/call-summary/migration docs (matches the dashboard's default view). Set `true` to cut that noise; leave default to see everything.
- **limit** (number, 1–100, default 100).
- **offset** (number, ≥0, default 0).

**Notes:**

- Returns each canvas's `viewAccessId` — pass that to `spaces-read-canvas` to read the body. Sorted by `updatedAt` desc.
- You only see canvases you can access (yours, shared with you, or public in your channels/projects) — the tool is scoped like the dashboard.
- "Find the real docs, not the bot summaries" → set `excludeCallGenerated: true`.

---

## spaces-read-canvas

Read a canvas's full markdown body. Use this **before** answering questions about a canvas the user attached.

**Required:** `viewAccessId`.

**Args:**

- **viewAccessId** (string, required) — From the canvas URL `/chat/canvas/<viewAccessId>` or from `spaces-canvases` results.

**Returns:** Title + full markdown body.

---

## spaces-calls

List calls/meetings by title, channel, status, type, time.

**Required:** none.

**Args:**

- **search** (string) — Title partial match.
- **channelId** (string) — One channel.
- **status** (string, enum: `ACTIVE | IN_PROGRESS | ENDED | SCHEDULED | CANCELLED`).
- **statusIn** (array, same enum) — Multiple statuses (matches any). e.g. `["ACTIVE","IN_PROGRESS","ENDED"]` for a Recents view. Overrides `status`.
- **callType** (string, enum: `VIDEO | AUDIO | HEADLESS`) — `HEADLESS` = xyne-automation **recordings** (the `/recordings` page). Pass `HEADLESS` to list recordings.
- **callOrigin** (string, enum: `CHANNEL | CONVERSATION | GOOGLE_CALENDAR | MICROSOFT_CALENDAR`) — Where the call came from — channel/conversation vs a Google/Microsoft calendar meeting.
- **organizerId** (string) — Organizer userID.
- **createdByUserId** (string) — Creator userID (outgoing calls when it's your own ID).
- **notCreatedByUserId** (string) — Calls NOT created by this user (incoming calls when it's your own ID). Ignored if `createdByUserId` is also set.
- **participantId** (string) — Calls this user attended / was invited to (a participant). Accepts a userID.
- **after** / **before** (string, ISO 8601) — Date range on the call's actual start time.
- **isRecurring** (boolean) — Only recurring calls.
- **limit** (number, 1–100, default 100).
- **offset** (number, ≥0, default 0).

**Notes:**

- Calls don't have a `conversationId` of their own — citations point to the call's Spaces thread.
- Recurrence rule (RRULE) is shown when `isRecurring=true`.
- "Recordings from last week" → `spaces-calls { callType: "HEADLESS", after: "<start>", before: "<end>" }`. "Calls I was in" → `spaces-calls { participantId: "<myId>" }`.

---

## spaces-meeting-insights

Semantic search over **AI-analyzed** meeting data — summaries, action items, pain points, decisions, Q&A, per-participant insights. Use this whenever the user asks about meeting *content*, not just the meeting list.

**Required:** none (but `query` strongly recommended).

**Args:**

- **query** (string) — Topic/question — e.g. `sales targets`, `action items`, `pain points`. Can be empty if filtering only.
- **platform** (string) — Comma-separated: `google-meet, zoom`.
- **participants** (string) — Comma-separated participant **emails**.
- **callType** (string) — e.g. `sales-call`, `onboarding`.
- **before** (string) — Date — `2024-01-01` or `15 Mar 26`.
- **after** (string) — Date.
- **on** (string) — Specific date.
- **range** (string) — `today | yesterday | this week | last week | last 7 days | this month | last month | last 30 days | recent`.
- **limit** (number, 1–20, default 10).

**Notes:**

- Empty query auto-sets `filterOnly=true` internally.
- Only **recorded + analyzed** meetings appear here. If the meeting wasn't recorded, no data — say so honestly.
- `participants` takes **emails**, unlike most other tools that want userIDs.

---

## spaces-emails

Full email thread for an Xyne Desk ticket — subject, from, to, cc, bcc, body, timestamps. **Only desk tickets** have emails; regular chat lives in `spaces-messages`.

**Required:** `conversationId`.

**Args:**

- **conversationId** (string, required) — From `spaces-tickets` results (desk ticket's conversationId).
- **limit** (number, 1–100, default 20).
- **from** (`first | last`, default `first`) — Start from the oldest or latest email.

**Notes:** Sorted chronologically. With `from=last`, the latest `limit` emails are selected and then displayed oldest-to-newest. Bodies are HTML — stripped to 500 chars in display. For full body or attachments, use `spaces-thread-attachments`.

---

## spaces-thread-attachments

List every non-deleted attachment in a thread. Returns id, filename, mimetype, size, uploader, posted time, source `messageId`.

**Required:** `conversationId`.

**Args:**

- **conversationId** (string, required) — Thread ID.
- **limit** (number, 1–200, default 50).

**Notes:** Use the returned `id` with `spaces-fetch-attachment` to download.

---

## spaces-fetch-attachment

Download an attachment. File lands in `.context/<fileName>` inside the agent workspace; use the standard `read` tool afterwards to view it.

**Required:** `attachmentId`.

**Args:**

- **attachmentId** (string, required) — From `spaces-thread-attachments`.

**Notes:**

- Two-step pattern: list → fetch.
- Filename is sanitized (no path traversal).
- Errors if the attachment was deleted.

---

## spaces-workflow-stats

Run counts + success/failure breakdown for a Spaces workflow over the last N days. Use for "how many times did X run", "how many failed", "who triggered X".

**Required:** one of `workflowName` OR `workflowType` (mutually exclusive).

**Args:**

- **workflowName** (string) — Exact name. Mutually exclusive with `workflowType`.
- **workflowType** (string) — e.g. `RELEASE_NOTES`. Mutually exclusive with `workflowName`.
- **sinceDays** (number, 1–90, default 7) — Window length.
- **includeChildren** (boolean, default false) — When true, counts nested executions too.

**Status enum:** `NEW, PENDING, SCHEDULED, RUNNING, SUCCESS, FAILURE, CANCELLED, WAIT_FOR_EVENT, PAUSED, WAITING_FOR_CHILD_EXECUTIONS, EXTERNAL_WAIT`.

**Phrasing note:** Use the exact terms `SUCCESS` and `FAILURE` in your reply — not `COMPLETED` or `FAILED`.

**Notes:** Returns `totalRuns`, `byStatus`, `topUsersByRunCount`, `firstRunAt`, `lastRunAt`. Caps at 1000 executions; `truncated=true` if more.

---

## spaces-my-items

The caller's **own** personal items — always scoped to you, read-only. One `type` selects the surface. Use it for "what have I drafted / scheduled / bookmarked / pinned?".

**Required:** `type`.

**Args:**

- **type** (string, required, enum: `drafts | scheduled | email-drafts | bookmarks | pinned`) —
  - `drafts` = saved chat-message drafts.
  - `scheduled` = scheduled / recurring message sends.
  - `email-drafts` = Desk email-reply drafts.
  - `bookmarks` = saved items (messages / conversations / tickets / canvases).
  - `pinned` = pinned messages/threads in channels you can access.
- **entityType** (string, enum: `message | conversation | ticket | canvas`) — For `type=bookmarks` only: narrow to one bookmarked kind.
- **completed** (boolean) — For `type=bookmarks` only: `true` = only completed, `false` = only open. Omit for all.
- **channelId** (string) — Limit to one channel. Applies to `pinned`, `scheduled`, and `email-drafts`.
- **limit** (number, 1–100, default 50) / **offset** (number, ≥0, default 0).

**When to use:** the user asks about **their own** saved/queued items — "what did I bookmark", "my scheduled messages", "any draft replies waiting in #support". For someone else's items or a shared view, this is the wrong tool (it's hard-scoped to the caller).

**Examples:**
- Open (uncompleted) ticket bookmarks: `spaces-my-items { type: "bookmarks", entityType: "ticket", completed: false }`.
- My email drafts in a desk channel: `spaces-my-items { type: "email-drafts", channelId: "<id>" }`.
- My scheduled sends in #announcements: `spaces-my-items { type: "scheduled", channelId: "<id>" }`.

---

## memory-search (shared knowledge bank)

Search the shared memory for business knowledge, past mistakes, debugging approaches, tool-use guidance, and reasons behind previous decisions captured across past sessions. Use it when that context helps, but treat memory as supporting context only: it can be stale or incomplete, so verify current facts against code, logs, databases, metrics, live tools, or the current conversation.

**Required:** `query`.

**Args:**

- **query** (string, required) — Natural-language query. Semantic match works better than keywords — be specific. e.g. `how to mention a user in Spaces`, not `mention`.
- **subsystem** (string) — Restrict to one subsystem from the injected taxonomy (e.g. `spaces`, `ticket-creation`).
- **limit** (number, 1–12, default 5) — Max memories.

**Notes:**

- Returns a numbered list of up to N memories.
- Empty result = nothing in the bank — don't re-query the same thing. Fall through to `spaces-search` / `spaces-canvases` / `spaces-meeting-insights`.
- Memory contents are authoritative — but they CAN go stale. If a memory contradicts something the user just said or just happened in Spaces, trust the live data.

---

# Write tools — approval required

These return `"Action queued for approval"`. That's **normal**, not an error. Tell the user to hit Approve. **Do NOT retry.**

---

## spaces-create-ticket

Create a new ticket. **Requires lookups first** — you need a project, a board, and a channel before this call works. Order: `spaces-projects` → `spaces-boards` → `spaces-channels` → `spaces-users` (for assignee) → `spaces-create-ticket`.

**Required:** `title`, `description`, `projectId`, `boardId`, `channelId`.

**Args:**

- **title** (string, required).
- **description** (string, required).
- **projectId** (string, required) — From `spaces-projects`.
- **boardId** (string, required) — From `spaces-boards`.
- **channelId** (string, required) — Where the ticket will live.
- **attachConversationId** (string) — Optional. If the user's triggering message had file attachments and they want those copied to the new ticket, pass the source thread's `conversationId` here. **Attachments only — does NOT change where the ticket lives.**
- **priority** (string, enum: `LOW | MEDIUM | HIGH | CRITICAL`).
- **assignedTo** (string) — userID. Use `spaces-users` to resolve a name.
- **eta** (string) — ISO 8601 due date.
- **tags** (array of strings).

**Notes:**

- Attachment transfer is best-effort — if it fails, the ticket still gets created and the failure is surfaced in the response.
- Returns `ticketId`, `xyneId`, `conversationId`, `status`, `priority`.

---

## spaces-update-ticket

Update an existing ticket. **At least one update field is required** beyond `ticketId`.

**Required:** `ticketId` + one or more update fields.

**Args:**

- **ticketId** (string, required) — **Internal database ID**, not the human-facing Xyne ID. `spaces-tickets` returns both — use the field labeled "Internal ID".
- **assigneeId** (string) — New assignee userID.
- **stage** (string) — Stage name. Must exist on the ticket's board (`spaces-boards`).
- **groupId** (string) — User group ID.
- **title** (string).
- **description** (string).
- **priority** (string, enum: `LOW | MEDIUM | HIGH | CRITICAL`).
- **status** (string, enum: `TODO | STARTED | PAUSED | CANCELLED | COMPLETED`).
- **eta** (string) — ISO 8601.

**Notes:**

- **Stage changes also change status** to the stage's default status — pass `status` explicitly to override.
- Only the fields you pass are updated.

---

## spaces-schedule-call

Schedule a call. Must provide either `channelId` **or** `targetUserIds`.

**Required:** `title`, `startsAt`, `endsAt`, plus one of (`channelId`, `targetUserIds`).

**Args:**

- **title** (string, required).
- **startsAt** (string, required) — ISO 8601, e.g. `2026-03-28T10:00:00Z`.
- **endsAt** (string, required) — ISO 8601.
- **channelId** (string) — Channel to schedule in.
- **targetUserIds** (array of strings) — Invite list of userIDs.

**Notes:** Returns `callId`, `externalId`, `channelId`.

---

## user-send-message

Post a message to a **DIFFERENT** thread or channel — NOT the one the user is talking to you in. The message appears in Spaces with the user's name + avatar (as if they posted it themselves).

**Important:** Your normal text response is automatically posted to the current thread by the framework. Calling this with the current thread's `conversationId` posts a duplicate. Only use this tool for cross-thread / cross-channel posts.

**Required:** `conversationId`, `content`.

**Args:**

- **conversationId** (string, required) — Target thread ID. **Must be a different thread** than the one you're chatting in.
- **content** (string, required) — Message body. Supports HTML for `@mentions` and basic formatting.

**When to use:**

- User explicitly says "reply to thread X with Y" or "post Y in #other-channel as me".
- You discovered a relevant thread elsewhere and the user asked you to add a note there.
- Relaying information across channels on the user's behalf.

**When NOT to use:** Normal answers to the current question — just return the text; the framework posts it.

**Notes:** `@Name[userId]` shorthand is server-expanded — resolve userIDs via `spaces-users` / `spaces-search` / `spaces-whoami` first; never invent one.

---

## spaces-create-canvas

Create a new canvas from markdown. User becomes OWNER.

**Required:** `title`, `markdown`.

**Args:**

- **title** (string, required).
- **markdown** (string, required) — Max 5MB.
- **visibility** (string, enum: `PUBLIC | PRIVATE`, default `PRIVATE`).

**Returns:** `id`, `viewAccessId`, `title`, `url`, `visibility`.

---

## spaces-edit-canvas

Replace canvas contents. Requires edit access (owner/editor/edit-link).

**Required:** `viewAccessId`, `content`.

**Args:**

- **viewAccessId** (string, required) — From canvas URL or `spaces-canvases`.
- **content** (string, required) — New markdown body. Max 5MB.
- **title** (string) — Optional new title.

---

# Quick-reference cheatsheet

**Before any tool call, ask yourself:**

1. Have I picked the right tool? (Check the picker.)
2. Did I scope it? (`channelId`, `conversationId`, or `in=`.)
3. Are all required args present?
4. For IDs — am I passing the right *kind* (userID vs email vs name, internal vs Xyne, conversationId vs channelId vs ticketId)?
5. After the result — does it actually answer the question, or just look related? If "just looks related", refine.

**Resolve before fire:**

- Name → userID: `spaces-users`
- Channel name → channelId: `spaces-channels`
- Project/board name → ID: `spaces-projects` / `spaces-boards`
- Caller's own userID: `spaces-whoami`

**Parallel-safe — fire these together** when you need both:

- `spaces-tickets` + `spaces-meeting-insights` (different surfaces, same topic)
- `spaces-users` + `spaces-channels` (resolving identities for a follow-up call)
- `spaces-canvases` + `spaces-emails` + `spaces-search` (broad sweep across surfaces)

**Sequential — must wait:**

- `spaces-thread-attachments` → `spaces-fetch-attachment` (need the ID first).
- `spaces-projects` → `spaces-boards` → `spaces-create-ticket` (each step feeds the next).
- `spaces-canvases` → `spaces-read-canvas` (need viewAccessId first).
