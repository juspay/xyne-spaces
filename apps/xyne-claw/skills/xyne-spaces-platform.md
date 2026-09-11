---
name: xyne-spaces-platform
description: The complete map of Xyne Spaces — what every entity is (channels, threads, tickets, boards, projects, calls, canvases, files, emails, activity, DMs, automations, knowledge base), how they connect, the IDs that tie them together, and the navigation playbook for "where does this information live?". Load when the user asks about platform concepts ("what is a channel?", "where would that conversation be?", "how do teams track this?"), when you need to figure out where a piece of information lives, or when you have to stitch a story across several surfaces.
---

# Xyne Spaces — the platform you live inside

Xyne Spaces **is** the workplace. Teams talk, decide, ship, and remember inside it. When someone asks you about "the org", "the team", "the project", or "what's happening", they almost always mean *what's happening in Spaces*. Your edge is knowing **where each kind of information lives** so you can go straight to it instead of fishing.

Two companion skills do the mechanics; this one is the map:
- **`spaces-tools-guide`** — exact args, required fields, and ID-vs-name pitfalls for every `spaces-*` tool.
- **`spaces-vespa-schema`** — how `spaces-search` actually works under the hood (the search index, what's matched, how to scope/count). Read it before you lean on search.

## The one rule that explains the whole platform: everything is permissioned to the asker

Every tool call runs **as the requesting user**. You see exactly what they see — their public channels, their private channels, their DMs, their tickets, their files — and **nothing they can't see**. This has three consequences you must internalize:

1. **You never need "access".** You are not a separate identity that gets "added to a channel". If a lookup comes back empty, that is a *search or scope* problem (wrong keywords, wrong channel id, wrong time window), **not** an access problem. Never tell the user "I need to be added to #x" — you already have their access.
2. **Empty ≠ doesn't exist.** It means *not found with what you tried*. Re-query with different angles before concluding "there's nothing".
3. **Private stays private.** If the asker can't see a private channel or someone's DM, neither can you — don't speculate about its contents.

## Most content is human; some is system-generated

People write the messages, file the tickets, run the calls, attach the files, ship the docs. The system generates a thinner layer on top: meeting summaries and action items, activity events, workflow run logs, release notes. Everything you cite traces back to something a real person did or said — so when you attribute a fact, attribute it to the human source, not "the system".

---

# The entities — what each one is and how to reach it

Think of Spaces as a tree of **containers** (channels, projects, boards) holding **artifacts** (messages, tickets, canvases, calls, files, emails), all glued together by a small set of **IDs**.

## Channels — the top-level containers

The main rooms. Usually one per team, project, topic, or incident.

- **Public** channels — anyone in the workspace can read/join. Most product, engineering, and ops work lives here.
- **Private** channels — invite-only. Sensitive work: compensation, M&A, leadership decisions, security incidents, legal.
- A channel hosts **threads, tickets, canvases, calls, files, and pinned items**.
- **Naming carries scope signal.** `#payments` (the team), `#payments-incidents` (a sub-stream), `#apollo-billing` (a project). When a user names a project/team, check whether a same-named channel exists — that's usually the front door.
- Channels have a **`scopeType`**: `DEFAULT` (normal channel), `DM` (1:1), `GROUP_DM` (small group), `TICKET` (a ticket's own thread), `DOCUMENT` (a canvas's thread). This is why a DM and a channel and a ticket-thread can all be "channels" under the hood.
- Reach: **`spaces-channels`** (by `name`, `visibility`, `scopeType`, `participantName`). Returns the **`channelId`**.

## Threads (conversations) — where the reasoning happens

A thread is a sub-discussion inside a channel. This is where decisions actually get made, not the channel's top-level feed.

- One thread ≈ one bug, one feature, one release, one decision, one question.
- Every thread has a **`conversationId`** — the single most important ID for *reading discussion*. `spaces-messages`, `spaces-emails`, and `spaces-thread-attachments` all key off it.
- "Why did we decide X?" → the answer is in a **thread**, found by search, then read in full with `spaces-messages`.
- DMs and group DMs are just threads with `scopeType=DM`/`GROUP_DM` — same `conversationId` shape, reachable the same way.

## Tickets — tracked work items

Structured work that lives inside a channel and carries real fields.

- Fields: **status** (`TODO | STARTED | PAUSED | CANCELLED | COMPLETED`), **priority** (`LOW | MEDIUM | HIGH | CRITICAL`), **assignee**, **creator**, **board**, **project**, **stage**, **tags**, **ETA/dates**, plus a title and description.
- **Every ticket has its own thread** (`conversationId`) — that's where the discussion lives. The ticket holds the *structured fields*; the thread holds the *conversation*.
- A ticket has **two IDs**: a human-facing **`xyneId`** (what users see and what search returns) and an **internal database `ticketId`** (what `spaces-update-ticket` requires). Don't mix them up. To go from one to the other: given an `xyneId` from a search hit, call `spaces-tickets`, which returns the row including the internal id (rendered as `id: …`) — that's the id `spaces-update-ticket` needs.
- **Desk tickets** are a special kind: support tickets whose thread is an **email** thread (`spaces-emails`) rather than chat. They live in a desk-typed channel (channel `type` EMAIL or SLACK; the full set is EMAIL/SLACK/DEFAULT/SUPPORT).
- For anything ticket-shaped — counts, status, ownership, what's blocking, daily triage — use **`spaces-tickets`**, never generic search. It has structured filters, aggregate summaries, and an actionable-classifier.

## Boards and projects — how tickets are organized

- A **board** is a kanban view: tickets flowing through **stages** in one workflow. Reach: **`spaces-boards`** (returns `boardId`).
- A **project** groups boards, channels, tickets, and people around a shared goal. Reach: **`spaces-projects`** (returns `projectId`); **`spaces-project-team-members`** lists everyone across its channels.
- You need a `projectId` + `boardId` + `channelId` to *create* a ticket.

## Calls (meetings) — synchronous conversations

Google Meet, Zoom, in-person.

- **The rule that matters: only recorded + AI-analyzed calls have recoverable content.** Those have summaries, action items, decisions, pain points, Q&A, and per-participant insights — semantically searchable via `spaces-meeting-insights`. **Un-recorded calls (in-person, ad-hoc) leave only a calendar entry** — you can confirm the meeting happened, but you cannot recover what was said. If a user says "we decided X on a call", check meeting-insights first; if there's nothing, say so honestly instead of guessing.
- **List vs content are two different tools.** `spaces-calls` gives you the *list*; `spaces-meeting-insights` gives you the *content*.
- Calls don't have their own chat `conversationId` the way threads do — citations point to the room/meeting. List fields: status `ACTIVE|ENDED|SCHEDULED|CANCELLED`, type `VIDEO|AUDIO`, organizer, recurrence.

## Canvases — rich collaborative docs

Design docs, runbooks, reports, decks.

- Each canvas has a **`viewAccessId`** — the id in its URL `/chat/canvas/<viewAccessId>`.
- **`spaces-canvases`** finds them (by title, channel, visibility `PUBLIC|PRIVATE|ORG|CHANNEL`, creator). **`spaces-read-canvas`** reads the full markdown body — always read the body before answering questions about a canvas.
- "Is there a doc/spec/runbook about X?" → canvases are usually the answer.

## Files & attachments — two distinct things

Spaces has **two** file surfaces; don't conflate them:

- **Thread attachments** — files posted into a chat thread or ticket. List with **`spaces-thread-attachments`** (by `conversationId`), download with **`spaces-fetch-attachment`** (lands in `.context/<file>`, then read it). In search, these are the **`attachments`** type.
- **Files / knowledge docs** — the broader file/document corpus (collections, canvases-as-files, transcripts, RCAs). In search, the **`files`** type (with sub-surfaces `canvas`, `transcript`, `rca`). See `spaces-vespa-schema` for how these split.

## Emails — threaded into Spaces

Incoming/outgoing email attached to **Desk tickets** (support). Reach with **`spaces-emails`** (by the desk ticket's `conversationId`) for subject/from/to/cc/body/history, and `spaces-thread-attachments` for files. Regular chat is *not* here — it's in `spaces-messages`. For composing replies, use the **`spaces-email-drafting`** skill.

## Activity feed — the asker's personal firehose

Per-user stream of mentions, replies, assignments, notifications. Reach: **`spaces-activity`**. Best for "what was I tagged in?", "what's waiting on me?", "what changed since yesterday?". Each row carries `messageId`, `conversationId`, `ticketId`, `channelId` so you can drill straight in. Scoped to the caller automatically — no userId arg.

## Knowledge base / shared memory — the authoritative shortcut

Business knowledge, past mistakes, debugging approaches, tool-use guidance, and reasons behind previous decisions captured across past sessions. Reach: **`memory-search`** when that context helps. Treat memory as supporting context only: it can be stale or incomplete, so verify current facts against code, logs, databases, metrics, live tools, or the current conversation.

## Automations & scheduled messages

Workflows that fire on triggers (cron, webhook, message, ticket events) — e.g. release notes, digests. Run counts and success/failure breakdowns via **`spaces-workflow-stats`** (by `workflowName` or `workflowType`). Scheduled messages are queued sends; once delivered they read as normal messages.

## Users / people

Real people in the workspace, each with a **`userId`** (shape `cm…`), name, email, status. Resolve a name/email → `userId` with **`spaces-users`**; get your own with **`spaces-whoami`**. You'll need `userId`s constantly because most filters take ids, not names.

---

# The ID taxonomy — the glue

Almost every navigation step is "I have id A, I need the tool that turns it into content B". Memorize this:

| ID | Identifies | Get it from | Feed it to |
|---|---|---|---|
| `channelId` | a channel / DM / group DM | `spaces-channels`, attached context, search hits | `spaces-tickets`, `spaces-activity`, `spaces-canvases`, `spaces-calls`; `in=` for `spaces-search` |
| `conversationId` | a thread / DM / ticket-thread / desk-email-thread | `spaces-tickets`, `spaces-activity`, `spaces-channels`, search hits, attached context | `spaces-messages`, `spaces-emails`, `spaces-thread-attachments` |
| `messageId` | one individual message | `spaces-messages`, `spaces-activity`, search hits | `spaces-message-detail` |
| `userId` (`cm…`) | a person (sender / assignee / creator / organizer) | `spaces-users`, `spaces-whoami` | `from=`/`assignee` filters, `assignedTo`, `createdBy`, `targetUserIds` |
| `xyneId` | a ticket (human-facing) | `spaces-tickets`, search hits | shown to users; resolve to internal id for updates |
| internal `ticketId` | a ticket (database) | `spaces-tickets` (rendered as `id: …`) | `spaces-update-ticket` |
| `projectId` | a project | `spaces-projects` | `spaces-tickets`, `spaces-boards`, `spaces-create-ticket` |
| `boardId` | a board | `spaces-boards` | `spaces-tickets`, `spaces-create-ticket` |
| `viewAccessId` | a canvas | `spaces-canvases`, canvas URL | `spaces-read-canvas`, `spaces-edit-canvas` |
| `attachmentId` | a file in a thread | `spaces-thread-attachments` | `spaces-fetch-attachment` |

**The cardinal sin is passing the wrong *kind* of id** — a channelId where a conversationId is wanted, a name where a userId is wanted, an xyneId where the internal ticketId is wanted. When in doubt, resolve first: one extra `spaces-users` / `spaces-channels` call is far cheaper than a confidently wrong answer.

---

# Navigation playbook — "where does this live?"

> Two tables, two jobs: use the **ID taxonomy** above when you already *hold an id* and need the tool that consumes it; use this **playbook** when you have an *intent* and need the surface.

Map the *intent* to the *surface*, then to the *tool*. (Args live in `spaces-tools-guide`; search internals in `spaces-vespa-schema`.)

| The user is really asking about… | It lives in… | Go to |
|---|---|---|
| A keyword/topic/person, location unknown | anywhere | `spaces-search` (then **fetch the full source**) |
| A specific channel's activity | a channel | `spaces-channels` → scope everything with that `channelId` |
| The reasoning / decision / "why" | a **thread** | search → `conversationId` → `spaces-messages` |
| Ticket status / counts / who-owns-what / blockers | **tickets** | `spaces-tickets` (never search) |
| What's waiting on *me* / mentions | the **activity feed** | `spaces-activity` |
| A doc / spec / runbook / report | a **canvas** | `spaces-canvases` → `spaces-read-canvas` |
| What was decided / said *on a call* | **meeting insights** | `spaces-meeting-insights` (recorded calls only) |
| Whether a meeting happened / is scheduled | the **call list** | `spaces-calls` |
| A support / email conversation | **desk emails** | `spaces-tickets` → `conversationId` → `spaces-emails` |
| A file someone shared | **attachments** | `spaces-thread-attachments` → `spaces-fetch-attachment` |
| "How/why do we…", policy, SOP | the **knowledge base** | `memory-search` **first** |
| A person → their id / email | **users** | `spaces-users` (`spaces-whoami` for self) |
| How often an automation ran / failed | **workflow stats** | `spaces-workflow-stats` |
| The asker's own email / calendar / Drive | **their Google** (not Spaces) | the `google` subagent — see `google-workspace` |

---

# How a real story fragments across the platform

Org context is rarely in one place. The life of a single decision typically spans:

- a **spark** message in a channel,
- a **thread** under it where the design takes shape,
- a **canvas** with the formal write-up,
- a **ticket** tracking the execution,
- a **call** where it gets approved,
- an **email** announcing it to a customer.

So a good answer to "what happened with X?" usually means **stitching 2–4 of these together** — search to find the entry points, then fetch each in full and reconcile. Two ways to do it:

- **Do it yourself** when the parts are clear: fire the independent lookups *in parallel* (e.g. `spaces-tickets` + `spaces-meeting-insights` + `spaces-canvases` on the same topic in one turn), then merge.
- **Delegate to the `spaces` subagent** when the question is open-ended, fuzzy, or genuinely multi-step ("piece together the history of the monolith split"). Always ask it to return citation tokens and carry them back **verbatim**.

When the question could also touch the asker's personal Google (inbox, calendar, Drive), run a Spaces lookup **and** a Google lookup in parallel and merge — don't default to Spaces-only. See `google-workspace`.

# What is NOT in Spaces

- Hallway / in-person conversations nobody wrote up afterward.
- The content of un-recorded calls.
- External tools that aren't integrated.
- The asker's private notes outside the workspace.
- The asker's personal Gmail/Calendar/Drive — those live in **their Google**, reached via the `google` subagent, *not* Spaces.

If a question can only be answered by something outside Spaces (and outside the asker's connected Google), say so plainly rather than manufacturing an answer.

---

# In one line

> Spaces is a permissioned tree of **containers** (channels, projects, boards) holding **artifacts** (threads, tickets, canvases, calls, files, emails), wired together by a handful of **IDs**. Answering a question = find the right surface, resolve the id, fetch the full source, and stitch when the story spans more than one.
