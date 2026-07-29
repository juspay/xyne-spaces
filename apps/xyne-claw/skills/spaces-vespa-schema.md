---
name: spaces-vespa-schema
description: How spaces-search actually works under the hood — the Vespa search index behind Spaces. Covers the document schemas (messages, attachments, channels, tickets, files, canvases, transcripts, RCAs, emails, users), how the `type` arg selects which schema you search, which fields your query text is matched against, hybrid lexical+semantic ranking and the fuzzy fallback, the real (and surprising) behavior of `from`/`in`/date/ticket filters, permission gating, how to read the IDs each hit returns, and how to scope, count, and paginate correctly. Load before relying on spaces-search, when results look wrong/empty/over-broad, when counting "how many X", or when a search isn't returning what you expect.
---

# The Vespa index behind `spaces-search`

`spaces-search` is a thin wrapper over a **Vespa** search cluster. Everything Spaces can search lives there as **documents**, split into typed **schemas**. Understanding the schema and how your args turn into a query is the difference between a search that lands the answer and one that returns noise — or nothing.

This skill explains the engine. For the bare arg list see `spaces-tools-guide`; for where things live conceptually see `xyne-spaces-platform`. Three things are true of *every* search:

1. **It's hybrid.** Your query runs as **lexical** (keyword/field matching) **and** **semantic** (vector / nearest-neighbor on embeddings) at once, then results are ranked together. So both exact keywords *and* meaning-similar phrasings can hit.
2. **It's permission-gated** to the asker — you only ever see what they see (full treatment in `xyne-spaces-platform`). So **empty results are a query/scope problem, never an access problem**: never tell the user you "need access". (Mechanically: a result must match `permissions contains <you>` OR `channelPermissions contains <you>` OR `ownerId contains <you>` OR a public channel/doc `isPrivate=false`.)
3. **Hits are shallow.** Each hit is a ranked **snippet** (the best-matching chunk, with matched terms **bolded**) plus IDs — **not** the full message/thread/ticket/file. It tells you *where* the answer is; fetch the full source before you conclude.

> **The single most counter-intuitive gotcha — burn it in:** `in=<channelId>` scopes **messages, attachments, tickets, and emails** to a channel, but it does **NOT** scope the `file` schema. So `type=files | canvas | transcript | rca` results **ignore `in` and come back workspace-wide**. To find a *doc* in a specific channel, use `spaces-canvases` with `channelId`, not `spaces-search` with `in`.

---

# The schemas, and how `type` selects them

Each row below is a `type` value you can pass; **`type`** is how you pick which schema you search. If you omit `type`, you search a **broad default set at once** (which excludes `channels` and the `file` sub-types) and results come back **grouped + capped** (see Counting, below).

| `type` value | Vespa schema | What's in it | What your query text matches | Drill into the hit with |
|---|---|---|---|---|
| `messages` | `chat_message` | chat messages in channels, threads, DMs | message `text`, sender `username`, `mentions`, thread context | `conversationId` → **`spaces-messages`** |
| `attachments` | `chat_attachment` | files **posted into a chat/ticket thread** | filename, extracted `chunks` (file contents) | `conversationId` → **`spaces-thread-attachments`** → **`spaces-fetch-attachment`** |
| `channels` | `chat_container` | the channels themselves | `channelName`, topic, description | the `channelId` (then scope other tools with it) |
| `tickets` | `ticket` | tracked work items | `title`, `description`, `xyneId`, `boardName`, `projectName`, `tags`, `stage`, `status`, creator/assignee names, mentions | `xyneId` → **`spaces-tickets`**; `conversationId` → `spaces-messages` |
| `files` | `file` | the document/knowledge corpus | `fileName`, `title`, extracted `chunks` (+ image chunks) | list via **`spaces-thread-attachments`** / open the doc surface |
| `canvas` | `file` (subApp `CANVAS`) | canvas docs | title + body chunks | `viewAccessId` → **`spaces-read-canvas`** (find via `spaces-canvases`) |
| `transcript` | `file` (subApp `TRANSCRIPT`) | call recordings/transcripts indexed as files | transcript chunks | **`spaces-meeting-insights`** for structured call content |
| `rca` | `file` (subApp `RCA`) | root-cause / incident docs | doc chunks | open the doc surface |
| `emails` | `mail` | **Desk (support) emails** | `subject`, body `chunks` | `conversationId` → **`spaces-emails`** |
| `users` / `people` | `user` | people in the workspace | name, email | prefer **`spaces-users`** for this — it's purpose-built |

**Read these implications carefully — they are the most common mistakes:**

- **`canvas`, `transcript`, and `rca` are all the `file` schema** with a sub-app filter — *not* separate schemas. `type=files` returns the **whole** file corpus *including* canvas/transcript/rca docs; the three sub-types are filtered subsets of it. **So never sum `files + canvas + transcript` — you'd double-count.**
- **`attachments` (chat_attachment) ≠ `files` (file schema).** Attachments are things people dropped into a thread. Files are the KB/document/canvas/transcript corpus. A doc you're looking for could be either — if one comes up empty, try the other.
- **`channels` is NOT in the default search.** When you omit `type`, chat is searched for messages + attachments only — channel documents are excluded. To find a *channel by topic/description*, you must pass `type=channels` (or just use `spaces-channels` by name).
- **Tickets via search are for free-text only.** For status/priority/assignee/board/stage/date filters and for *counts*, use `spaces-tickets` — it's structured and accurate. Use `type=tickets` + `query` only when you're matching ticket *text*.
- **People search → use `spaces-users`.** `type=users/people` works but `spaces-users` resolves names/emails → `userId` far more reliably.

The default (no `type`) searches: **messages, attachments, tickets, files, users, and emails** — grouped by surface, **capped per surface**. Good for "is this anywhere?"; bad for completeness or counts.

---

# How your query text is matched (and how to write a good query)

When you pass a `query`, Vespa runs up to three things and blends the scores:

1. **Lexical match** — your terms are matched against each schema's text/field indexes (message text, ticket title/description, file/attachment chunks, channel name, mail subject, etc.).
2. **Semantic match** — your query is embedded and compared by vector similarity against the documents' content embeddings, so a *meaning-similar* doc can rank even without the exact words. **Semantic only kicks in for queries longer than 3 characters.** Very short queries (≤3 chars) are lexical-only — so a 2-letter acronym won't get semantic help.
3. **Fuzzy fallback** — if the first pass returns too few good results, the engine *automatically* reruns with typo-tolerant fuzzy indexes (`title_fuzzy`, `description_fuzzy`, `text_fuzzy`, `chunks_fuzzy`, `subject_fuzzy`) and merges them in *after* the exact hits. You don't trigger it. Two consequences: small misspellings/partial words still surface something; and **low-ranked hits in a sparse result set may be fuzzy guesses, not strong matches — don't over-trust the tail.** Note: this fallback is **skipped entirely for `file`-schema searches** (`type=files | canvas | transcript | rca`) and transcript-only searches — those get no fuzzy retry, so spelling matters more there.

*How to write the query itself* — restructuring the asker's words into varied, parallel search angles — is owned by **`ask-ai-first-principles`** (the asker's sentence is never a query). The engine-specific facts that make those tactics work:

- **Matched terms come back bolded** (`**like this**`) in the snippet — use that to judge *why* a hit matched, not just that it did.
- **Each hit shows a `score`** (relevance). Higher = stronger; use as a confidence signal, never as proof — open the source.
- **Both lexical and semantic run together**, so meaning-similar phrasings hit even without exact words — but only above the ~3-char semantic threshold; a 2–3 letter acronym is effectively lexical-only.
- **Empty `query` = filter-only mode.** Omit `query` to browse by filters alone ("latest 10 files in #design" → `type=attachments, in=<channelId>, range='last 7 days'`). No flag needed.

---

# What the filter args REALLY do (the gotchas)

The filter args are overloaded across schemas in ways that aren't obvious from their names. Get these wrong and you'll silently filter the wrong thing.

### `from` = **authored-by**, and it's three things at once
`from=<userId>` maps to: message **sender** (chat), ticket **creator** (tickets), and file **creator** (the `createdBy` field — covers uploaded attachments *and* KB docs/canvases) — simultaneously. So:
- It is **NOT** "ticket assignee". For "tickets assigned to X", use `spaces-tickets` with `assignedTo`, or `assignee=` here.
- It takes a **`userId` only** — never a name, never an email, never a channel/conversation id. Resolve names → ids with `spaces-users` first. A wrong id type here can produce a bad request or silent emptiness.

### `in` = channel scope — but **not for files**
`in=<channelId>` scopes **messages, attachments, tickets, and emails** to that channel. It does **NOT** scope the `file` schema — so **`type=files` / `canvas` / `transcript` / `rca` results ignore `in`** and come back workspace-wide. To find a *doc* in a specific channel, use `spaces-canvases` with `channelId`, or scope by `type=attachments` (which *is* channel-scoped) if it was posted in-thread. `in` is the only place a channel id goes (never put it in `from`).

### Date filters apply to messages/tickets/files — **not emails**
`before` / `after` / `on` / `range` filter **chat, tickets, and files** by creation time. They do **NOT** filter the `mail` schema. So you can't date-window Desk emails through these args — read the thread with `spaces-emails` instead. Prefer `range` (`today | yesterday | this week | last 7 days | last 30 days`) for natural windows; use `before`/`after` (ISO 8601 or `15 Mar 26`) only for hard cutoffs. (Time phrases inside the `query` text itself are also detected and bias results toward that window — but explicit `range` is cleaner.)

### Ticket-only filters
`status`, `priority`, `board`, `tags`, `stage`, `assignee` apply **only to the ticket schema**. They're here for convenience, but `spaces-tickets` does all of this better and with structured output — prefer it for anything ticket-shaped.

### What's filtered out for you, always
- **SYSTEM messages** are always excluded from chat results.
- **BOT messages** are excluded by default.
- Anything outside the asker's permission set is excluded (the permission gate).

---

# Reading a result — the IDs each hit carries

Every hit is formatted as a chunk that **carries a verbatim `[clf-…#n]` citation token** — attach it to any claim you draw from that hit (rules in `spaces-citations`). Each hit also exposes the IDs you need to drill in. Depending on the surface a hit carries some of:

- **`conversationId`** — the thread. Feed to `spaces-messages` (chat) or `spaces-emails` (desk mail) or `spaces-thread-attachments`.
- **`channelId`** — the channel it's in.
- **`messageId`** — the specific message (chat hits). Feed to `spaces-message-detail`.
- **`xyneId`** — the ticket (ticket hits). Feed to `spaces-tickets`.
- **`mailId`** — the specific desk email (email hits).
- Plus display context: sender name, `#channelName`, timestamp, ticket status, and the relevance `score`.

**The fetch step is mandatory unless the snippet alone unambiguously answers the question.** Pattern: search broad → scan hits → pick the top 1–3 → fetch each in full → synthesize. Answering from a lone snippet is the #1 cause of partial/wrong answers.

---

# Counting and pagination — where searches go wrong

### Never count grouped snippets — the default cap is a hard 10 per surface
Without `type`, results are **grouped by surface, and each surface is capped at a fixed 10 rows regardless of `limit`** — raising `limit` does *not* raise the per-surface cap. So the "(N)" next to a group is at most 10 and tells you nothing about the true total. **Tallying grouped rows undercounts.** To get a real count:
1. Pass **`type=<surface>`**. A single `type` narrows the search to one underlying app, which turns grouping **off** — the result then comes back as a flat list led by **"Found N result(s)"**, the real count for that surface. (Exceptions: `emails` are deduped to one row per thread, so "Found N" = N threads; `users`/`people` fall back to the grouped default — use `spaces-users` instead.)
2. A concept can span surfaces ("issues" = tickets **and** desk items **and** in-channel messages) — count each relevant `type` and sum.
3. **For ticket counts specifically, use `spaces-tickets`** (with `summary=true`) — it's exact.

### Paginate to exhaustion when you need the whole set
In the flat/ungrouped mode (single `type`, or `offset > 0`), **`limit` is a real page size — 1–100, default 100.** A page that comes back **full** (`results == limit`) means **there's more**: loop with `offset += limit` until a page returns **fewer** than `limit`; what you paged through is then the complete set. (Setting `offset > 0` also drops grouping, which is exactly what you want for paging.) Don't try to paginate the default grouped view — its per-surface 10-cap can't be paged; switch to a single `type` first.

> Note: the `spaces-search` tool's own description prose may quote different bounds (e.g. "1–50, default 10") — the **enforced** schema is 1–100, default 100. Trust 100.

### Don't trust a single empty filtered result
An empty result under a filter — especially a `range`/`before`/`after` window or an `in=<channelId>` scope — is ambiguous: truly nothing, *or* the scope/filter is wrong. Before answering "none":
1. Re-run **without** the time filter. Still empty → check the channel/scope (right `channelId`? right `type`?).
2. Non-empty → the window really is empty; say so with context.

Never report a bare "none" off one empty filtered call.

---

# Recipes — intent → exact search

- **"What's the latest in #payments?"** → `in=<paymentsChannelId>, range='last 7 days'` (resolve the channel id first with `spaces-channels`). Omit `type` for a cross-surface sweep, or `type=messages` for just chat.
- **"Find the design doc for the new onboarding flow."** → `type=canvas, query='onboarding flow design'`. (Don't expect `in` to scope it — canvas ignores `in`; use `spaces-canvases` with `channelId` if you must scope.)
- **"Did Sarah raise anything about refunds?"** → resolve Sarah → `userId` via `spaces-users`, then `from=<sarahId>, query='refunds'` (matches her messages, tickets she created, files she uploaded).
- **"How many open bugs are there?"** → ticket-shaped: use **`spaces-tickets`** (`status`, `summary=true`), not search. If you must count via search, pass a single `type` and read "Found N" / paginate — never tally a grouped view.
- **"Latest 10 files shared in #design."** → `type=attachments, in=<designChannelId>, range='last 30 days'` (attachments *are* channel-scoped; `type=files` would **not** honor `in`).
- **"Any support emails about the outage?"** → `type=emails, query='outage'`. (Can't date-filter mail via `range` — read threads with `spaces-emails` to scope by time.)

---

# In one line

> `spaces-search` = hybrid lexical+semantic over permission-gated Vespa schemas. `type` picks the schema; `from` means authored-by (userId only); `in` scopes chat/tickets/emails but **not files**; dates skip emails; grouped results are capped — `type` to count and paginate to exhaustion; and **every hit is a shallow snippet — fetch the full source before you answer.**
