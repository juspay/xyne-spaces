# Digital Twin Memory v2 — Design & Implementation Plan

**Status:** Design approved · **Landed: Phases 1–6 + curator retry, plus the full runtime respond/ignore layer & post-plan hardening (see §7)** · Only the phase-plan's Phase 7 (source registry refactor, internal) still pending
**Branch:** `feature/claw-main-digitwin-improv`
**Last updated:** 2026-07 — §7 added to capture work beyond the original phase plan: the runtime respond/ignore gate, the Vespa thread-fetch migration, the behavioral-capture (ignore-signal) fixes, curator timeout fixes, the triage subsystem + memory-write tool, per-user twin sessions, the twin-reply ownership fix, and pipeline observability.

> **Table rename:** the file store is generic across agents — `AgentMemoryFile`
> (`agent_memory_files`), scoped by `(agentSlug, userId, name)`. The twin passes
> `agentSlug="digital-twin"`; `userId` NULL = shared across an agent's users.
**Author:** curated from a cross-subsystem code audit (curator ingestion, curator LLM,
twin prompt assembly, Hindsight provider, Spaces message/thread model, psql schema,
source abstraction).

---

## 0. Decisions locked

| Fork | Decision |
|---|---|
| Spaces-side change budget | **claw-only + one allow-list**: derive behavior in claw-auth, plus allow-list `conversationParticipant` for exact responded/ignored truth. Reactions deferred. |
| Privacy scope | **Context-only**: read co-participants' messages to *ground* the user's behavioral facts; stored memories stay **about the user** (others' text is reasoning input, never stored verbatim as the user's memory). |
| soul.md model | **Auto-compiled from approved facts, user-editable.** A periodic synthesizer compiles it; user can hand-edit; regenerates as facts grow. |
| Build order | **Context Assembler first** (biggest quality lever), then soul.md/file-store, then registry + tools. |

---

## 1. Diagnosis — why the twin is thin today

**The curator's *prompt* is already excellent; the *data* feeding it is starved.**

`xyne-claw/src/user-memory-curator.ts` `SYSTEM_PROMPT` explicitly demands WHAT + HOW:
voice, openers/sign-offs, ack style, per-person tone shifts, "trigger → response",
active projects, who they work with. It even has a dedicated `type = mention_reply`
section that pairs *an incoming message aimed at the user* with *how the user answered*.

But the ingestion layer never gives it any of that:

- **`fetchUserMessages` (`userMemoryFetcher.ts:157`)** queries `type=messages, from=userId`
  → **only the user's own outgoing messages**, as a flat bag.
- The Spaces vespaSearch transformer (`resultTransform.ts:451 transformMessage`)
  **already returns** `conversationId` (thread), `scopeType` (DM / GROUP_DM / DEFAULT),
  `replyCount`, `senderId/senderName` on every hit — and the fetcher's
  `VespaSearchResult` interface + mapper **drop all of it** at `userMemoryFetcher.ts:180-190`.
- `ts` is a **human-formatted string** (`"Jul 15, 2025, 3:04 PM"`), not sortable — so even
  time-ordering within a batch is impossible.
- **`mention_reply` is never produced by ingestion.** It exists only as a one-off in the
  post-approval forward loop (`userMemoryCuratorClient.ts:391 learnFromTwinReply`). The
  batch curator never receives a single incoming↔reply pair.
- Chunking is **by count** (40 flat records/batch, cap 50) with no thread/conversation
  grouping. A fact evidenced across a 60-message thread can be split across batches and
  never grounded.

**"What the user ignores" is structurally impossible today** — a `mention_reply` only
exists when the user *did* reply. Non-responses are never fed in.

Net: the intelligence lives in the prompt; the data starving it lives in the fetcher.
**The highest-leverage change is a preprocessing/assembly layer**, not a prompt rewrite.

### Secondary findings

- **Hindsight is the wrong home for a deterministic `soul.md`.** No get-by-name; tag
  filtering **over-matches** (returns the whole bank — incident 2026-05-25, re-filtered in
  JS everywhere); async retain returns **no id** (so we never capture memory ids →
  `candidate.hindsightMemoryId` is always null); retain **shreds** a document into scattered
  LLM-extracted facts; no update/patch (only soft-invalidate). A verbatim doc comes back as
  fragments. → **soul.md and named files must live in psql.**
- **The twin persona is forked** (a latent bug for "always-loaded soul.md"): the real
  @mention flow uses claw's **hardcoded** `buildSystemPrompt` (`agent.ts:474`) because
  `webhook.ts` forwards **no** `systemPrompt`; the interactive chat flow uses the seeded DB
  prompt. soul.md must reach **both** paths.
- **Source list is hardcoded in ~18 backend + ~9 frontend sites** with no registry; the
  source kind is even smuggled through a colon-delimited string and positionally re-parsed
  (`digitalTwinPipelineEvents.ts:73 deriveSourceKind`).

---

## 2. Target architecture — four layers

```
                        ┌─────────────────────────────────────────────┐
   Spaces backend       │  xyne-claw-auth (backend)                    │   xyne-claw (LLM)
   (Postgres via        │                                              │
    /api/query/claw     │   ┌────────────────┐   ┌─────────────────┐   │
    + /api/vespaSearch) │   │  Source        │   │  Context        │   │
   ──────────────────►  │   │  Registry      │──►│  Assembler      │──►│──► /internal/user-memory/distill
    messages / threads  │   │  (pluggable)   │   │  (conversation  │   │      (curator LLM, richer prompt)
    conversations       │   └────────────────┘   │   units, thread │   │            │
    channels (scopeType)│                         │   -complete,    │   │            ▼
    activities (mentions)│                        │   time-aware,   │   │      candidates → HITL → Hindsight
    conversationParticipant│                      │   responded/    │   │            │
     (lastReplyAt) ◄── 1-line allow-list          │   ignored)      │   │            ▼
                        │                          └─────────────────┘   │      Soul Synthesizer (periodic)
                        │                                                 │            │
                        │   ┌──────────────────────────────────────┐     │            ▼
                        │   │  File-memory store (psql)             │◄────┼──── compiles soul.md
                        │   │  twin_memory_file (userId,name) uniq  │     │
                        │   │  + versions   → soul.md (pinned)      │─────┼──► always-loaded into twin prompt
                        │   └──────────────────────────────────────┘     │      + read_memory_file / write_memory tools
                        └─────────────────────────────────────────────┘
```

1. **Context Assembler** *(new, claw-auth)* — the heart. Converts raw records into
   **conversation units**: full thread (co-participants included, as context) + parent
   message + channel type (DM vs public) + incoming↔outgoing pairing + **responded/ignored**
   label with latency + time-adjacency. Replaces count-batching with conversation-aware chunks.
2. **File-memory store** *(new, psql)* — `twin_memory_file` keyed `(userId, name)`, versioned;
   holds `soul.md` (pinned = always-loaded) and future named docs. Deterministic
   `WHERE user_id=$1 AND name=$2` retrieval. Backs the `read_memory_file` / `write_memory` tools.
3. **Soul synthesizer** *(new, claw curator mode)* — compiles `soul.md` from the user's
   **approved** facts (not raw records); user-editable; regenerated as facts grow.
4. **Source registry** *(refactor)* — one `TWIN_SOURCES` array; add/remove a source in one place.

---

## 3. Data model changes (psql / Prisma, claw-auth)

### 3.1 File-memory store (Phase 3)
```prisma
model TwinMemoryFile {
  id          String   @id @default(cuid())
  userId      String
  name        String   // "soul.md", "projects.md", ...
  content     String   @db.Text
  pinned      Boolean  @default(false)   // pinned == always-loaded into the prompt
  activeVersion Int    @default(1)
  updatedBy   String?  // "synthesizer" | "user" | "agent"
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([userId, name])
  @@index([userId, pinned])
}
model TwinMemoryFileVersion {   // mirrors AgentPromptVersion — the repo's one versioning pattern
  id         String   @id @default(cuid())
  fileId     String
  version    Int
  content    String   @db.Text
  createdBy  String?
  sessionId  String?
  createdAt  DateTime @default(now())
  file       TwinMemoryFile @relation(fields: [fileId], references: [id], onDelete: Cascade)
  @@unique([fileId, version])
}
```

### 3.2 Behavioral signal (Phase 2, optional table)
Behavioral facts are ultimately captured *as memories* by the curator, so a raw-event table
is optional. If we want queryable analytics / dedup of ignore-events:
```prisma
model TwinBehaviorSignal {
  id          String   @id @default(cuid())
  userId      String
  eventType   String   // "mention" | "dm" | "reply"
  outcome     String   // "responded" | "ignored"
  channelId   String?
  channelType String?  // "dm" | "group_dm" | "public" | "private"
  respondedWithinMs Int?
  occurredAt  DateTime
  sourceMessageId String?
  createdAt   DateTime @default(now())
  @@index([userId, occurredAt])
  @@index([userId, eventType, outcome])
}
```
*Decision for Phase 2:* start **without** this table (feed signals straight into the assembler
→ curator); add it only if the UI/analytics need raw events. Rolling-prune like
`DigitalTwinPipelineEvent` if adopted (high volume).

### 3.3 Extend the shared curator record (Phase 1)
`xyne-claw-shared/src/memory/user-memory-types.ts` — `UserMemoryRecord` gains an optional
thread envelope (kept backward-compatible; existing flat records still valid):
```ts
type: "message" | "call" | "canvas" | "mention_reply" | "conversation"   // + conversation
// new optional fields on UserMemoryRecord:
tsEpoch?: number                 // sortable, from Vespa createdAtTimestamp / real createdAt
channelType?: "dm" | "group_dm" | "public" | "private"
conversationId?: string
thread?: {
  parent?: { author: string; text: string }
  messages: { author: string; authorIsUser: boolean; text: string; tsEpoch: number }[]
  userRole: "author" | "mentioned" | "participant"
  behavior?: { trigger: string; outcome: "responded" | "ignored"; latencyMs?: number }
}
```

---

## 4. Phase plan

> Each phase is independently shippable and typecheck-gated
> (`tsc --noEmit` clean across shared / backend / claw / frontend).

### Phase 1 — Context Assembler  *(FIRST — the quality lever)*
**Goal:** the curator receives thread-complete, time-ordered, channel-typed, responded/ignored
conversation units instead of blind outgoing-message chunks.

1. **Stop discarding data** in `userMemoryFetcher.ts`: widen `VespaSearchResult` to keep
   `scopeType`, `conversationId`, `replyCount`, `senderName`; add `orderBy:"newest"` and use
   `createdAtTimestamp` (epoch) for a real `tsEpoch`.
2. **New fetch primitives** (all via existing `interact()` /api/query/claw, ACL-safe — same
   pattern as the existing canvas path):
   - `fetchThread(conversationId)` → `message where {conversationId} orderBy createdAt asc`
     (co-participant messages included) + `conversation where {conversationId}` (parentMessageId,
     channelId, replyCount).
   - `fetchChannelsMeta(channelIds)` → `channel where {id in […]}` (scopeType/visibility/name).
   - `fetchInboundMentions(userId, window)` → `activity where {actorAction in
     ["mentioned_user","group_mention"], createdAt:{gte,lte}}` (auto-scoped to the user).
   - `fetchParticipation(userId, conversationIds)` → `conversationParticipant where
     {userId, conversationId in […]}` → `participationType`, `lastReplyAt`, `lastReadAt`.
     *(requires the Phase-6 one-line allow-list; until then, derive from own-message presence.)*
3. **`contextAssembler.ts`** (new): given (userId, window):
   - collect conversationIds from the user's own messages + inbound mentions;
   - fetch each thread + channel meta + participation;
   - build `ConversationUnit`s with the `thread` envelope + `behavior` label
     (`lastReplyAt != null` → responded (latency = lastReplyAt − mention.createdAt);
     `participationType == MENTIONED && lastReplyAt == null` → **ignored**);
   - **privacy filter:** co-participant text is included *inline as context* but the assembler
     emits units flagged so the curator only writes facts **about the user**.
4. **Wire** the assembler into the two ingestion loops (backfill worker + daily) **behind a
   flag** `TWIN_CONTEXT_ASSEMBLER=1`, so we can A/B the old flat path vs the new units.
5. **Shared type** change from §3.3.

**Spaces dependency:** the one-line `conversationParticipant` allow-list (Phase 6) is pulled in
here for exact ignore-truth; assembler works with a derived fallback until it lands.

#### Phase 1 — LANDED (flag-gated `TWIN_CONTEXT_ASSEMBLER=1`)
Files: `xyne-claw-shared/src/memory/user-memory-types.ts` (+ `index.ts` ×2 re-exports) —
`UserMemoryRecord` gains `type:"conversation"`, `tsEpoch`, `channelType`, `conversationId`,
`thread{parent,messages,userRole,behavior}`; `xyne-claw/src/routes/user-memory.ts` allows the
new type; `xyne-claw-auth/backend/src/services/contextAssembler.ts` (NEW — the assembler +
ACL-safe fetch primitives + transcript renderer); `userMemoryFetcher.ts` exports
`resolveAuthForUser`; `userMemoryCuratorClient.ts` `SourceRef` gains `"conversation"`; wired
flag-gated into `digital-twin-backfill-worker.ts` (`fetchForSource`) + `digitalTwinDaily.ts`.

- **Behaviour when ON:** the `messages` source emits thread-complete `conversation` units
  (full thread + parent + channel-type + responded/ignored) instead of flat outgoing messages.
  Calls/canvases untouched. Source key stays `messages` → pipeline/sourceKind unaffected.
- **Design choices:** each unit renders a budget-bounded transcript into `record.text`, so the
  **existing** curator prompt consumes it with no change (Phase 2 renders from `thread` directly).
  Only "interesting" conversations (mentioned / ≥2 own msgs / has replies) get a full thread
  fetch; drive-by posts render lightweight from own messages — keeps per-window Spaces calls
  bounded. Caps: `TWIN_ASM_MAX_CONVERSATIONS` (60), `TWIN_ASM_MAX_THREADS` (60),
  `TWIN_ASM_THREAD_MSG_CAP` (40), `TWIN_ASM_THREAD_CONCURRENCY` (6) — all logged when hit.
- **Responded/ignored:** exact via `conversationParticipant.lastReplyAt` when allow-listed
  (Phase 6); otherwise derived (a later user message in the thread ⇒ responded). Never throws.
- **Rollout:** set `TWIN_CONTEXT_ASSEMBLER=1` on claw-auth; re-run a backfill (or wait for the
  daily) for an opt-in user; inspect the pipeline viewer — fed records now read as conversation
  transcripts with `RESPONDED in 4m` / `IGNORED (no reply 3d)` headers. Unset to revert instantly.

### Phase 2 — Curator prompt & behavioral capture  *(LANDED)*
- Assembler renders each unit compactly (channel type · role · `RESPONDED in 4m` /
  `IGNORED (no reply 3d)` header · parent · turns) into `record.text`; caps widened
  (`TWIN_ASM_RENDER_BUDGET` 3000, `TWIN_ASM_TEXT_CAP` 3600) so multi-turn threads survive.
- Curator (`user-memory-curator.ts`): conversation records slice at `MAX_CONVERSATION_CHARS`
  (3600) instead of 1500 so the thread isn't re-truncated; `SYSTEM_PROMPT` gains a
  "Conversation units" input kind + a "Reading conversation units" section that mines BOTH
  **RESPONDED** (shape/latency/who) and **IGNORED** (what/where the user skips, ≥2-unit
  threshold) and repeats "facts about the user only — never a co-participant".
- Single renderer lives in the assembler (claw-auth); the curator consumes its text (no
  double-render). Structured `thread` remains on the record for future finer-grained use.

### Reliability — curator retry  *(LANDED, addresses batch-loss bug)*
`distillUserMemory` (`xyne-claw/src/user-memory-curator.ts`) now retries the LLM call up to
`USER_MEMORY_CURATOR_MAX_ATTEMPTS` (default 3) on transient/output-quality failures
(`no-tool-call`, `bad-json`, `malformed-candidates`, 5xx, timeouts) with linear backoff —
previously a one-off `malformed-candidates` discarded the whole window's records. One attempt
extracted into `runDistillAttempt`; the trace now carries `attempts` (shown in the pipeline
viewer). 4xx / `no-api-key` are permanent and not retried.

### Phase 3 — File-memory store + always-loaded persona  *(LANDED)*
- Migration `20260716140000_agent_memory_files` + generic `AgentMemoryFile` model +
  `agentMemoryFiles.ts` service (20k-char cap, max-3 loaded, `ensureDefaultFiles`).
  **Default file set** (same structure for every user, seeded on enable): `soul.md`,
  `people.md`, `projects.md` (loaded by default) + `playbook.md`, `expertise.md` (opt-in).
- Twin routes: `GET/PUT/DELETE /memory-files`, `POST /memory-files/:name/load`
  (user-configurable prompt loading, capped at 3). Internal S2S `GET /memory/agent-prompt-files`.
- **Persona injection (dissolves the fork):** claw fetches the loaded files
  (`memory.ts fetchAgentPromptFiles`) and injects them as a **promptInjection** (`run.ts`,
  `id="__twin-persona"`) — which reaches BOTH the @mention and interactive paths, so no
  `agent.ts`/`webhook.ts` surgery was needed. → twin works with **zero tool calls**.
- Frontend: `DigitalTwinFilesTab` (Persona overlay) — edit files, char counter vs 20k, toggle
  which ≤3 load into the prompt, delete, "Rebuild from memories".

### Phase 4 — Soul synthesizer  *(LANDED)*
- `twin-soul-synthesizer.ts` (claw) compiles ONE file from approved facts (uses ONLY the facts,
  ≤ cap); route `POST /internal/user-memory/synthesize-file`. claw-auth `twinSoulSynthesizer.ts`
  pulls approved facts grouped by subsystem → calls claw per file → `upsertFile(updatedBy=
  "synthesizer")`. Subsystem→file map lives in `DEFAULT_TWIN_FILES.subsystems`.
- **Never clobbers user edits** (`updatedBy==="user"` → `preserveEdits`). Triggers: nightly
  (`digitalTwinDaily`) + on-demand `POST /digital-twin/synthesize` (202, background).

### Phase 5 — Mid-chat memory tools  *(LANDED)*
- `memory-file-tools.ts` (claw): `read-memory-file` (deterministic by name / list) +
  `write-memory-file` (create/append/replace, `updatedBy="agent"`). Registered at the
  memory-tool site in `run.ts`, twin-only. Backed by internal `GET/POST /memory/agent-file`.

### Phase 6 — Spaces one-line allow-list (exact behavioral truth)  *(LANDED)*
- Added `'conversationParticipant'` to `ALLOWED_MODELS`
  (`backend/src/services/pythonQuery/validator.ts`). `ConversationParticipantsACL` already
  exists + wired (`acl-factory.ts:111`), scoped to workspace + channels the user is in — zero
  new ACL code. The assembler's `fetchParticipation` now returns exact `lastReplyAt` truth
  (responded/ignored via `source:"participation"`); falls back to derivation if absent.
  (`'reaction'` deferred.)

### Phase 7 — Source registry + frontend
- `sourceRegistry.ts`: `TWIN_SOURCES: { id, recordType, label, glyph, defaultLimit, walkable,
  fetch(), count() }[]`. Derive `BackfillSource`, `BACKFILL_SOURCES`, `PipelineEventSourceKind`,
  count shape, and the frontend estimate/progress/glyph rendering from it.
- Store `sourceKind` **explicitly** on `DigitalTwinPipelineEvent` (kill the positional
  colon-string parse in `deriveSourceKind`).
- `countUserRecords` → `Record<sourceId, number>`; estimate API + UI iterate the registry.

---

## 5. Phase 1 detail — the Context Assembler

**Assembler output rendered to the curator (example — responded):**
```
[conv_abc] #eng-platform (public) · 5 msgs · user MENTIONED · RESPONDED in 4m
  parent  @alice: "kicking off the ACL refactor — who owns messages-acl?"
  ─ @alice:  "@you can you take the conversationParticipant allow-list?"
  ─ @you:    "on it — looking now"
  ─ @you:    "lgtm, one nit: scope it to workspace on line 14"
  ─ @bob:    "nice"
```
**(ignored):**
```
[conv_xyz] #general (public) · user MENTIONED by @bob · IGNORED (no reply in 3d)
  ─ @bob: "@you can you own the migration doc?"
  (no response from user)
```

This hands the curator exactly the "trigger → response" and "trigger → ignored" it already
asks for — with real threads, channel type, and latency — while co-participant lines are
context only. The privacy decision is enforced in the prompt ("facts about the user only").

**Assembler algorithm (pseudocode):**
```
assembleWindow(userId, {from,to}):
  own       = fetchUserMessages(userId, window)            # now keeps conversationId + tsEpoch
  mentions  = fetchInboundMentions(userId, window)         # activity: mentioned_user/group_mention
  convIds   = unique(own.conversationId ∪ mentions.conversationId)
  parts     = fetchParticipation(userId, convIds)          # participationType, lastReplyAt (exact)
  threads   = map(convIds, fetchThread)                    # full thread + parent (co-participants incl.)
  chans     = fetchChannelsMeta(unique(threads.channelId)) # scopeType → dm/group_dm/public/private
  units = for each convId:
            build ConversationUnit(thread, channelType, userRole, behavior)
            behavior = derive(mentions@conv, parts@conv, own@conv)  # responded/ignored + latency
  return units   # → UserMemoryRecord[] with type="conversation", thread{...}
```

**Complexity / cost note:** thread + channel + participation fetches are N extra
`/api/query/claw` calls per window (N = distinct conversations). Mitigate by (a) batching
`channel where {id in […]}`, (b) capping threads/window, (c) `log()`-ing any cap so we never
silently truncate coverage.

> **SUPERSEDED (see §7.1):** the per-conversation thread body fetch was moved OFF Spaces
> `/api/query/claw` (which hits the app's source-of-truth psql) ONTO claw-auth's own
> **direct-Vespa read replica** (`buildYqlFromParams` + `queryDirect`), so the N+1 no longer
> touches psql. Caps were also raised substantially for completeness.

---

## 6. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Assembler N+1 fetch cost on heavy users | **RESOLVED (§7.1):** thread bodies now come from claw-auth's direct-Vespa read replica (batched), not Spaces psql; caps raised + logged |
| `/api/query/claw` returns scalar rows (senderId, not names) | resolve names via one batched `user where {id in […]}`; or use Vespa `senderName` where already present |
| Bigger prompts (threads ≫ single messages) blow the model window | re-tune `MAX_RECORDS_PER_BATCH`; truncate long threads to head+tail around the user's turns |
| Persona fork means soul.md silently not loaded on mentions | Phase 3 explicitly patches **both** `run.ts:2763` and `agent.ts:2688` + adds a boot log |
| Hindsight tag over-match leaking cross-user | unaffected — file store is psql-partitioned by `userId` column, not tags |
| Co-participant text privacy | context-only; prompt enforces "facts about the user only"; nothing co-participant stored verbatim as the user's memory |
| Spaces allow-list surface | single Set addition, ACL pre-exists + scoped; no new endpoint |

---

## 7. Beyond the phase plan — runtime respond/ignore layer & hardening

Phases 1–6 built the **memory ingestion** pipeline (assemble → curate → approve → soul.md).
Everything below was built *after* that plan and is **LANDED on `feature/claw-main-digitwin-improv`**
unless marked. It covers the **runtime** layer (how a twin decides to reply and posts *as* the
user) plus the reliability/observability hardening the pipeline needed in practice.

### 7.1 Assembler thread-fetch migrated off Spaces psql → Vespa
Phase 1 originally fetched thread bodies via Spaces `/api/query/claw` (psql). Because Spaces psql
is the app's **source of truth** and cannot be throttled, the assembler's N+1 thread-fetch was
moved to claw-auth's **own direct-Vespa read replica** — `fetchThreadsBatch` uses
`buildYqlFromParams` + `queryDirect` (`contextAssembler.ts`), ACL + workspace guards auto-injected,
`conversationId` → Vespa `threadId`, batched at `TWIN_ASM_VESPA_THREAD_CHUNK`. Gotcha baked in:
Vespa stores `deletedAt = 0` (not null) for live messages, so `isDeleted = Number(deletedAt) > 0`.
Parity-verified against the psql path. Vespa's hard 400-hits/query ceiling is respected via
chunking (`chunk × THREAD_MSG_CAP ≤ 400`). Completeness caps were raised (all env-tunable):
`OWN_MSG_LIMIT` 400→**2000**, `MENTION_LIMIT` 300→**1000**, `MAX_CONVERSATIONS` 60→**1000**,
`MAX_THREADS` 60→**1000**, `THREAD_MSG_CAP` 40→**80**.

### 7.2 Behavioral capture fixes — the "500 memories but 0 ignore signals" bug
Three stacked bugs made "what the user ignores" silently impossible even with the assembler on:
1. **Mentions were read from the (empty, local) `activities` table** → switched to deriving
   mentions from `messages.content` (`data-user-id="…"` HTML spans), unioned with activities.
2. **`conversationParticipant.lastReplyAt` is conversation-level, not the user's own reply** —
   it misclassified 231/309 "ignored" as responded. Behavior is now derived from **message
   authorship** (a later message *by the user* in the thread ⇒ responded).
3. **INT4 overflow:** an ignored latency (`now − mention`, ~15 B ms) overflowed the INT4
   `latencyMs` column → every ignored upsert threw silently. Clamped to `Math.min(…, 2_147_483_647)`.

Result: a test user went from **0 ignored** to **112 ignored / 82 responded**. Also, per
"don't ignore anything," the `msgType='USER'` filter was lifted so bot/system turns are included.

### 7.3 Curator reliability — undici timeouts
The "5-minute" curator timeouts were **not** a config value — they were undici's default 300 s
`headersTimeout` on the non-streaming LLM call. Fixed with a no-timeout undici `Agent`
dispatcher on **both** legs (`xyne-claw/src/litellm-retry.ts` + claw-auth
`userMemoryCuratorClient.ts`), an escalating per-retry timeout (10/12/14 m), and `maxRetries:0`
on the inner call to de-nest the curator×litellm retry loops (which had been multiplying the budget).

### 7.4 Runtime respond/ignore gate
Before replying to an @mention, claw-auth runs an LLM **gate** (`shouldTwinRespond` →
claw `decideRespond`, forced-tool `emit_decision`). The earlier deterministic rails 1–4 were
**removed** — every mention now goes through the LLM; DM + thread-participation are fed as strong
"respond" signals rather than hard short-circuits. **FAIL-OPEN by design** (any error → reply).
- Model: `TWIN_RESPOND_GATE_MODEL ?? LITELLM_MODEL ?? "claude-haiku-4-5-20251001"`.
- Recall is **triage-scoped** (`tags:[user:<id>, subsystem:triage]`) with a broad fallback; the
  user's behavioral **ratio stats** are sent to the gate LLM.
- Default policy migrated `"always"` → **`"learned"`** for all users (schema
  `digitalTwinRespondPolicy`, migration `20260718000000_twin_gate_default_learned`) so every
  twin consults the gate.

### 7.5 Triage subsystem (9th memory facet) + memory-write tool
- New **`triage`** value in `UserMemorySubsystem` (`user-memory-types.ts`) — respond-vs-ignore
  behaviour (which senders / channels / channel-types / message-types the user engages with vs
  stays silent on). The gate reads this facet directly (§7.4).
- **`memory-write.ts`** (claw, twin-only tool) — the twin agent can *self-learn*: retain a fact
  tagged `[user:<id>, subsystem:<s>, scope:user, origin:agent]` mid-run.

### 7.6 Per-user twin sessions & multi-mention fan-out
Twin runs are keyed **per mentioned user** (`buildSandboxStoreKey` chokepoint), so each person's
twin runs in its own session. A message mentioning several people **fans out** one dispatch per
mentioned user (`dispatchRunForTarget(twin.userId,…)`, `targetUserId` per iteration). Channel
coverage is additive via a targeted twin-delivery app user (`DIGITAL_TWIN_APP_EMAIL`).

### 7.7 Twin-reply ownership fix (the "session mismatch")
For a USER_MENTIONED reply, the `AgentRun` + the `user` chat-message are written under the
**mentioned owner** (dispatch, `run.ts`), but the **assistant** chat-message in the `/result`
callback was written under **`ctx.senderId`** (the sender). Consequences: the sender saw the
reply in *their* regular history (`findByUserAndAgent(sender,…)`), and the owner **couldn't see
her own twin's reply** (the per-user read ACL filters `m.userId !== viewer`). Fixed: added
`targetUserId` to `SessionContext`, resolved `runOwnerId` in `/result`, and tagged all three
assistant `chatMessageRepository.create` sites with it. Existing mis-tagged rows were backfilled.
(The admin "All Runs" cross-user view is a separate, intentional audit path and was left as-is.)

### 7.8 Pipeline observability
`DigitalTwinPipelineEvent` (free-form `status` + JSON `trace`, rolling-pruned) now records, and
the dashboard surfaces + filters: curator batches (with **running/retry** states + `attempts`),
the soul **synthesizer** (start/finish), and **gate decisions** (`runType="gate"`, full LLM
exchange). Gate **failures** (timeout / HTTP / bad response) are recorded as `status="error"`
events with the failure reason (previously failures fail-opened silently and were invisible),
shown via an "Error" filter + a red banner in the gate detail. Frontend also got memories
pagination and a constellation with zoom + a time-window (7d/30d/90d/All).

### 7.9 Hindsight timeout tuning
Per-operation Hindsight HTTP timeouts are env-tunable (`HINDSIGHT_*_TIMEOUT_MS`,
`xyne-claw-shared/…/hindsight.ts`); **`recall` bumped 10 s → 60 s** because it sits on the gate
+ agent memory-search hot paths and was timing out under a slow/self-hosted Hindsight.

### 7.10 Backfill Stop / Resume — PLANNED (not built; deferred until this branch merges to prod)
The dashboard's "backfill in progress" is a stale-flag bug: the banner reads
`backfillState.some(s => !s.complete)`, but *liveness* lives only in the Redis (BullMQ) job — so
if the job disappears (queue-clear, `removeOnFail` eviction, exhausted attempts) without setting
`complete:true`, the banner spins forever with no job running. The backend **already** computes
the truthful, job-aware signal (`buildBackfillBlock.overall.running/stalled` + a per-source
`job:null` probe) — the UI just ignores it. Planned, in order:
- **Self-heal** (~2–3 h): point the banner at the job-aware signal; render "Interrupted — Resume"
  when `job:null && !complete`. Prevents recurrence.
- **Resume** (~2–3 h): ~80 % built — the cursor is persisted per source and the worker resumes
  idempotently; add a re-enqueue that **preserves** `cursor` (never `cursor=from`, which is a full
  re-walk) + a route + a button.
- **Stop** (~3–5 h): reuse `cancelDigitalTwinBackfill`, add a distinct `stopped` flag (not
  `complete:true`, which would break Resume), teach the predicates, add a button.
- Optional boot-time reconcile that re-enqueues incomplete backfills with no live job.

---

## 8. Deferred / future

- Reactions (👍 endorsement signal) — needs `reaction` allow-list + Vespa isn't indexing them
  (`mapper.ts:415 reactions: 0 // TODO`). Deferred per decision.
- Per-user Hindsight banks (today a single shared bank + `user:` tag) — revisit if semantic
  recall volume grows.
- `runId`-exact pipeline grouping (today heuristic).
```
