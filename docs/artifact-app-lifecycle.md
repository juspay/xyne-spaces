# Artifact Apps — Lifecycle, Versioning & Collaboration Plan

> M1–M5 shipped in PR #855 (**merged to `main` as `11a759adb`**): `create-app`
> tool, Sandpack rendering, live reads (`useXyneData`), writes
> (`useXyneMutate`), agent invocation (`useXyneAgent`), save/publish, and
> host-side name resolution (`useXyneDirectory`).
>
> **Step 1 (one app per conversation) is shipped and verified** — see below.
> Steps 2–5 remain planned: in-place updates, version restore, collaborative
> creation, and fork / change-requests.

## The problem being fixed

Today **every `create-app` call produces a brand-new, unrelated artifact.**
The tool has no update path; each call writes fresh bytes to GCS and a fresh
`ChatAttachment`. Real data from local dev: one conversation holds **five
independent artifacts all titled "Univer Spreadsheet"** — one app iterated five
times, stored as five orphans. Consequences:

- clutter: threads and (if saved) the Library fill with near-duplicates, most
  of them dead iterations;
- cost + truncation: a one-line fix re-emits the entire project (up to 256KB)
  from the model, which is exactly the output-budget failure that plagued M1;
- regression risk: each "fix" is a from-memory re-imagining, so it can silently
  drop something that worked two turns ago;
- the M2 versioning machinery (`ArtifactAppVersion`, content-hash dedup,
  `addArtifactAppVersion`) already exists but is **orphaned** — nothing in the
  chat flow ever calls it.

## Product decisions (user-confirmed, 2026-08-30)

1. **One conversation = one app.** The first generation in a session creates
   it; everything after updates it.
2. **Updates modify the same app**, never spawn a sibling.
3. **Restore version**: a user can roll the app back to any earlier iteration
   with one click — still the *same* app.
4. **No second app per session.** Deliberately not supported; do not build an
   escape hatch for it.
5. **Collaborative creation (later)**: invite others via the existing
   group-DM constructs; if a group with those users exists, the app lives in a
   message thread there so everyone sees the record.
6. **Fork & change requests (later)**: published apps can be forked by other
   users, or receive a change request that the owner approves/rejects — the
   same review pattern claw agents use (`AgentRequest`).

---

## Architecture in one picture

```
conversation (chat thread, later: group-DM thread)
     │ 1:1
ArtifactApp ──── headVersionId ──► the version everyone currently sees
     │ 1:N                         (restore = move this pointer)
ArtifactAppVersion (immutable; contentHash-deduped; createdBy per author)
     │
     └── publishedVersionId (unchanged from M2: what non-owners see)
```

Two pointers, two audiences:

- **`headVersionId`** — what the owner/collaborators see and what the agent
  bases its next update on. Moves forward on every generation, backward on
  restore.
- **`publishedVersionId`** — what the rest of the workspace sees (M2,
  unchanged). Publishing pins; head can keep moving without disturbing it.

---

## Step 1 — One app per conversation ✅ **SHIPPED 2026-08-31**

**Delivered requirements 1, 2, 4.** The app is a first-class object from the
first generation — no Save click — and every later generation versions it.

### What shipped

- **Schema**: `ArtifactApp.conversationId String? @unique` (the unique index IS
  the one-app-per-session rule, enforced by Postgres) and
  `headVersionId String?`. Migration
  `20260830120000_artifact_app_session_scoping`.
- **`src/lib/artifact-app-session.ts`** — `attachArtifactToSessionApp()`:
  re-validates through `buildReactArtifact`, then creates the app (v1, always
  `PRIVATE`) or appends a version with contentHash dedup, and moves head. It
  returns `null` and never throws: a failure here must not lose the user's
  artifact, which still renders as a plain attachment.
- **Card addressing**: `{appId, versionId}` stamped onto
  `metadata.reactArtifact`; `toArtifactRef` carries `versionId` so each card
  pins the build *its* turn produced.
- **Save button hidden** when `artifact.savedAppId` is set — saving is implicit
  now. It survives only for pre-scoping artifacts and for the rare failed
  materialization. Publish stays explicit; auto-materializing never auto-shares.
- **Owner payload serves head** (`artifact-apps.ts`):
  `requestedVersionId ?? headVersionId ?? publishedVersionId`. Non-owners are
  still served the pin and only the pin — serving head, or honouring a
  caller-supplied `versionId`, would expose unpublished drafts.
- **Tool description** gained the SESSION section telling the agent a
  conversation has ONE app.

### Correction to the plan: there are TWO persistence paths, not one

The plan put the hook in the agent-chat callback. That was wrong and shipping it
that way missed the AI screen entirely — **`run-stream.ts` has its own
attachment persistence**, and `/ai/chat` goes through it, not through
`agent-chat.ts`. The materialization call therefore lives in the shared lib and
is invoked from **both** paths:

- `agent-chat.ts` → `persistAssistantResult`
- `run-stream.ts` → its own assistant-result persistence

Anything future that writes a `reactArtifact` attachment (the channel/webhook
surface in Step 4) must call the same lib, or it will silently create orphans
again. Grep for `attachArtifactToSessionApp` before adding a surface.

### Verified end-to-end (2026-08-31, local)

A "Counter" app generated then modified in one thread:

| | version | bytes | contentHash | head |
|---|---|---|---|---|
| 08:42:25 | v1 | 4364 | `14675aac80ad` | |
| 08:43:47 | v2 | 4477 | `19d77f541d42` | **←** |

`count(*) FROM artifact_apps WHERE conversationId = …` = **1**. Diffing the two
payloads out of the GCS emulator showed a genuinely targeted edit — the Reset
button moved out of the badge row and became a full-width button — with the
keyboard shortcuts, click counter and card structure byte-identical. Before this
change that second turn produced a second unrelated app.

### Deferred out of Step 1

- ~~The "newer version exists" chip on stale cards.~~ **Shipped** after this
  doc was first written, as `ArtifactSavedIndicator` — a Saved chip linking to
  the app, and a "Newer version (vN)" chip when the card's build is behind head.
  Staleness is measured against `headVersionId`, never the highest version
  number, so a restored-to earlier head is correctly shown as current.
- **Title drift** handling: the app keeps its v1 title unconditionally today.

### Edge cases (as implemented)

- **Regenerate / edit-message** forks the message tree but keeps one
  `conversationId` → both branches version the same app; head is
  last-write-wins. Restore (Step 3) is the recovery path.
- **`scheduled_` / `app_` conversations** are skipped by `isChatConversation()`
  — only real chat threads materialize apps.

---

## Step 2 — True incremental updates (read-back + patch mode)

**Goal:** make "update" mean *edit*, not *re-imagine*. This is where the
truncation risk and the regression risk actually die.

**The gap:** the agent never sees the code it wrote. The tool result carries
only the manifest (file *paths*); the bytes go to GCS. So today it rewrites the
whole project from conversational memory.

### Design: merge inside the tool, wire format unchanged

`create-app` gains:

```jsonc
"mode": "update",              // default "create"; "update" only valid when the
                               // conversation already has an app
"files": [...],                // ONLY the files that changed
"deleteFiles": ["/old.tsx"],   // removals, since patch mode can't infer them
```

In update mode the tool:

1. Fetches the conversation's **head** payload from claw-auth over S2S
   (new internal route
   `GET /claw/api/v1/internal/artifact-apps/by-conversation/:convId/payload`,
   `requireStrictS2S`; the tool context already carries `s2sKey` and the
   claw-auth URL via platform config).
2. Merges: base files ∪ changed files − deleted files; `dependencies` and
   `dataRequirements` replace-if-present, inherit otherwise.
3. Re-validates the **merged whole** through `buildReactArtifact` (entry still
   present, limits, reserved paths — a patch must not be able to sneak past
   validation that a full build would fail).
4. Emits the full merged payload in the attachment exactly as today.

The elegance: **nothing downstream changes.** Attachment bytes still carry the
complete project, Step 1's callback versioning works untouched, the renderer is
oblivious. Only the model's *output* shrinks from "entire project" to "the
diff" — which is the whole point.

### Read-back for the agent

A tiny companion tool, `read-app-file` (`source: "custom:react-artifact"`):
given a path (or no path → the file list + sizes), returns the head version's
content over the same S2S route. Description: *"Before an update, read the
files you intend to change; send back only those."* Stripped for
`artifact_app` runs alongside `create-app` (recursion guard already exists in
xyne-claw `run.ts`).

### Failure modes

- S2S fetch fails mid-update → tool returns a retryable error ("could not load
  the current app; retry or use mode create") rather than silently doing a full
  rebuild.
- Update mode with no existing app → validation error steering to create.
- Merged project over limits → normal limit error, names the biggest files.

### Verification

"Change the header colour" on a 15-file app → tool call contains **one** file;
resulting version diffs from head in exactly that file (compare via the Code
tab / `@pierre/diffs`). Delete flow removes a file and the merged build still
validates. Output tokens for a small fix drop from ~10–16k to hundreds.

---

## Step 3 — Restore version

**Goal:** requirement 3 — one click back to any earlier iteration, same app.

### Why a head *pointer* and not a copy

`@@unique([appId, contentHash])` (the dedup rule) makes "insert an old version
again as a new row" impossible by design. A pointer sidesteps it: restore never
duplicates content, it just declares which immutable version is current.

### Backend

- `POST /artifact-apps/:id/restore { versionId }` — owner (later: collaborator)
  only; validates the version belongs to the app; sets `headVersionId`.
- Reads: **already done in Step 1** — the owner payload route serves
  `requestedVersionId ?? headVersionId ?? publishedVersionId`; non-owner
  behaviour unchanged (pinned published version only). Only the write half
  (the restore route) and the UI remain.
- Step 2's update mode bases on head — so after a restore, "now add X" edits
  the restored iteration, which is exactly what a user means.

### UI

The expanded dialog (and `ArtifactAppScreen`) gains a version dropdown —
`GET /:id` already returns the full version list for owners — with per-version
"Restore" . Restoring updates the card in place. Publish keeps offering "publish
current head".

### Verification

v1→v2→v3, restore v1 → head=v1, card shows v1, agent update produces v4 based
on v1 (v2/v3 still in history). Published pin untouched by restore.

---

## Step 4 — Collaborative creation via group DMs

**Goal:** requirement 5. Several people build one app together, with the record
visible to all of them.

### Model: the conversation moves into the group DM

Reuse the existing constructs end-to-end rather than inventing a sharing UI:

- Inviting = adding people to a **group DM** (existing flow). If a group DM
  with exactly those users exists, use it; otherwise Spaces already creates it.
- The app's owning conversation becomes a **message thread in that channel**,
  where the claw agent is invoked via the existing channel/mention surface —
  every generation is a message all members see, which is requirement 5's
  "record there" verbatim.
- `ArtifactApp` gains `channelId String?`. Edit rights derive from **channel
  membership at request time** (no new share table): any current participant
  may generate updates and restore; the creator remains `ownerUserId` and alone
  may publish/archive. Leaving the group loses edit access automatically —
  the same semantics people already understand from DMs.
- `ArtifactAppVersion.createdBy` (already exists) gives per-author attribution
  in the version list.

### What must be built

1. A "make this collaborative / invite people" action on an existing app:
   creates-or-finds the group DM, posts the app card into a new thread there,
   and re-keys the app's `conversationId` to that thread.
2. Channel-surface runs must flow through the same auto-materialize hook —
   verify the webhook/channel callback path persists reactArtifact attachments
   like the chat path (implementation-time check; it shares the attachment
   pipeline).
3. Concurrency: two members updating simultaneously → the second hits the
   normal "one run per conversation" session lock; versions serialize. Head is
   last-write-wins, restore is the safety net.

### Open questions (decide at build time)

- Does a collaborator's `useXyneData` still resolve as the *viewer* (it must —
  M3's per-viewer ACL rule is non-negotiable), and is that clearly signalled
  when collaborators see different data in "the same" app?
- Can collaborators publish, or owner-only? (Default: owner-only.)

---

## Step 5 — Fork & change requests on published apps

**Goal:** requirement 6, modelled on the claw-agent review flow
(`AgentRequest`: `requestType` clone/push, `status` pending/approved/rejected —
`schema.prisma:1199`).

### Fork

- `POST /artifact-apps/:id/fork` — any user who can *view* the published app.
- Creates a new `ArtifactApp` owned by the requester (`forkedFromAppId`,
  `forkedFromVersionId` recorded), version 1 = the **pinned published**
  version's bytes (never the owner's drafts — same rule as the payload route).
- The fork is re-keyed to the forker's own new conversation so they iterate on
  it with the agent exactly like an app they created. Their ACLs apply to its
  data from the first open (M3 guarantees this already).

### Change request

New model `ArtifactAppChangeRequest`, deliberately shaped like `AgentRequest`:

```
appId, requesterId, status: pending|approved|rejected,
proposedStoragePath + contentHash + manifest   (a built, validated payload),
note, reviewedBy, reviewedAt, workspaceId
```

Flow:

1. Requester iterates on a fork (or a scratch conversation), then
   "Request change on <original>" — submits their current head as the
   proposal. The proposal's bytes are copied at submit time (same
   copy-not-reference rule as M2 save).
2. Owner sees pending requests on the app (Library badge + app screen list),
   reviews the **diff against current head** using the existing Code tab /
   `@pierre/diffs` infrastructure.
3. **Approve** → append as a new `ArtifactAppVersion` with
   `createdBy = requester`, move head; optionally re-publish. **Reject** →
   status + note. Either way the requester is notified (existing notification
   constructs; same as agent clone-request DMs).

Guards: proposal re-validated through `buildReactArtifact` at approve time
(stored bytes are never trusted — same rule as save); one pending CR per
(app, requester); CRs against an app that was archived/unpublished are
auto-rejected.

---

## Step 6 — App Creation mode (persistent split view)

**Goal:** the v0 / Lovable / Replit shape. Chat on the left, the app itself
persistent on the right, versions switchable from a dropdown. Requested
2026-08-31 with a reference screenshot; the target is the *layout*, not the
theme.

Today the app is a card inside the transcript and "expand" is a **modal**
(`ReactArtifactDialog`). That is backwards for a build session: the thing you
are iterating on disappears behind the thing you are typing into, and every
open/close remounts the Sandpack iframe. Step 1 made a conversation own exactly
one app — which is precisely what makes a single persistent pane correct rather
than ambiguous.

### What already exists (do not rebuild)

| Need | Already there |
|---|---|
| Split layout | `AIShell` is a `ResizableGroup[Panel(sidebar) │ Separator │ Panel(main)]` |
| Sidebar collapse | `react-resizable-panels@4`: `collapsible` + handle `.collapse()`/`.expand()`; `AIShell` already holds `sidebarPanelRef` |
| The renderer | `ReactArtifactView` with `fill` — the dialog already uses it this way |
| "Which app is this thread's?" | Step 1's `conversationId @unique` + `headVersionId` |
| Version list | `GET /artifact-apps/:id` already returns every version for the owner |
| Serving one version | payload route already honours `requestedVersionId` for the owner |

So Step 6 is **composition plus one new panel**, not new infrastructure. The
only genuinely new UI is the version dropdown and the mode's empty state.

### Design

Three panels when the mode is on:

```
[ sidebar (collapsed) │ chat thread │ app pane (persistent) ]
```

- **The sidebar is not auto-collapsed** (reversed 2026-08-31, after shipping it
  the other way). Driving the panel imperatively means racing the group's own
  deferred re-layout: `expand()` is a no-op unless the panel is collapsed *at
  the instant it is called*, so a single call fired in the commit where the
  third panel unmounts gets clobbered a frame later and the sidebar stays shut.
  Worse, auto-collapse/auto-expand overrides whatever width the user chose.
  The Panel stays `collapsible`, so it is one drag away. If this ever returns,
  it needs a settle strategy and a user preference, not a one-shot call.
- **Entering the mode.** DECISION: auto-enter the first time the conversation
  materializes an app, and expose an explicit toggle to leave. Rationale: it
  matches the reference products (you type, it builds, the preview appears),
  needs no new affordance to discover, and Step 1 guarantees there is exactly
  one app to show. The trigger lives in ONE predicate so it can be changed to
  explicit-only without touching the layout.
- **The pane renders head by default**, and whatever version the dropdown
  selects otherwise. Selecting an old version is a *view*, not a restore: head
  does not move. Restore stays Step 3's verb, and lands in this same dropdown.
- **A new generation updates the pane in place** — the pane is keyed by the
  conversation's app, not by a message, so when head advances the pane follows.

### The hazard that decides the implementation: two live Sandpacks

If the pane renders the app while the transcript still renders its inline
cards, the same app runs **twice** — two iframes, two `useXyneData` bridges, two
agent bridges, double the queries, and writes firing from whichever the user
happens to click. In the mode, the inline cards must therefore degrade to a
compact, non-executing reference ("Version 3 — shown in the pane") that scrolls
to / selects in the pane rather than mounting a second preview.

Two further remount rules, both already learned the hard way:

- `ArtifactSandpack` is `memo`'d with a shallow compare — anything crossing that
  boundary must stay a stable ref or a plain boolean, never a fresh object or
  callback. This is why the directory/data bridges read the store imperatively.
- The pane must be **mounted once and kept**, not conditionally re-created per
  turn. A new version should change its `payload`, not its identity — otherwise
  every generation costs a full iframe boot and the running app's state.

### Layout persistence

`AIShell`'s group persists under `autoSaveId='ai-screen-resize'`. A saved
two-panel layout must not be applied to the three-panel arrangement, so the
mode uses its own `autoSaveId` and the plain chat layout keeps the existing one.
`AIShell` is shared with `AISectionLayout` (knowledge, library) — those must
render byte-identically, so the third panel is strictly opt-in via prop.

### What must be built

1. `AIShell` gains an optional `rightPanel` (ReactNode). Absent → today's exact
   two-panel tree. **No `collapseSidebar`**: see the decision below.
2. `ArtifactAppPane` — header (title, version dropdown, publish/expand), body
   `ReactArtifactView fill`. Owns the `['artifact-app', appId]` query the
   Saved/Newer chip already uses, so both stay consistent and a restore
   invalidates one key.
3. Mode state on the conversation (which app, which version is being viewed,
   is the mode on) — one hook, so the trigger predicate is single-sourced.
4. Inline cards become compact references while the mode is on.

### Verification

Generate in `/ai/chat/new` → pane appears, sidebar is left ALONE, exactly ONE
Sandpack iframe in the DOM. Ask for a change → the SAME pane shows the new
build; the iframe is not re-created (watch for a preview flash / lost app
state). Dropdown to v1 → pane shows v1, `headVersionId` in the DB is unchanged.
Toggle the mode off → sidebar returns, inline cards render live again, and the
knowledge/library screens are untouched. A thread with no app never enters the
mode.

---

## Sequencing & effort

| Step | Ships | Depends on | Size |
|---|---|---|---|
| ~~1. One app per conversation~~ **done** | killed the clutter (reqs 1, 2, 4) | — | S — schema + shared hook on *both* persistence paths + card addressing |
| 2. Incremental updates | kills truncation + regressions | 1 | M — S2S read route, merge+validate in tool, `read-app-file` |
| 3. Restore | req 3 | 1 (head pointer lands with 1) | S — one route + version dropdown |
| 4. Group-DM collaboration | req 5 | 1–3 stable | M/L — re-key flow, channel-surface parity, membership ACL |
| 5. Fork + change requests | req 6 | 1–3 (4 independent) | M — two routes + CR model + review UI on existing diff view |
| 6. App Creation mode (split view) | the v0/Lovable build surface | 1 (3 folds into its dropdown) | M — `AIShell` right panel + app pane + compact inline cards |

Recommended order: **~~1~~ → 6 → 3 → 2 → 4 → 5.** Step 1 is done. Step 6 comes
next because it is where the rest is *seen*: restore needs a version dropdown to
live in, and incremental updates only feel different if you are watching the app
change. Step 3 follows immediately — its read half already landed with Step 1,
so it is one route plus a Restore item in Step 6's dropdown, and it de-risks
Step 1's last-write-wins choice.

## Standing constraints (do not rediscover)

- Tool descriptions live in `xyne-claw-shared`; **`tsx --watch` does not reload
  it** — claw + claw-auth restarts are required after every description change.
- The four CAC flags (`react_artifact_config`, `_publish_`, `_write_`,
  `_agent_`) all default `true` for local testing and **must flip to `false`
  before merge**.
- The wire markers `REACT_ARTIFACT_START/END` and the `metadata.reactArtifact`
  key are frozen — persisted data depends on them.
- Migrations on both DBs use the `migrate diff` / `db execute` /
  `migrate resolve --applied` path; and the local Spaces DB has **no
  `_prisma_migrations` ledger** — never run `migrate deploy` against it.
- **Two assistant-result persistence paths exist** (`agent-chat.ts` and
  `run-stream.ts`); the AI screen uses the latter. Any new artifact surface must
  call `attachArtifactToSessionApp` from both, or it creates orphan apps.
- **A conversation's workspace is keyed by conversation, not run**
  (xyne-claw `run.ts`). pi's `SessionManager.continueRecent(cwd, sessionDir)`
  *also filters candidates by cwd*, so a per-run workspace made every turn
  resume an empty session — silently, while still logging "Resuming". Multi-turn
  app updates depend on this; Step 2's read-back doubly so. A
  `session_resume_empty` metric + error log now fires if it ever regresses.
- **`deleteWorkspace()` has zero callers.** Now that workspaces are
  conversation-scoped they are long-lived and unbounded — a reaper is owed
  before this ships anywhere real.
- Agent `orderBy` must be an **array**; the AST gateway 400s on the object form
  models naturally write. Normalized client-side in `artifactAstClient.ts`.

## Dev-environment traps that cost hours

- **Running the dev stack under `pmg`** (SafeDep package-manager guard) exports
  `HTTPS_PROXY` + `NODE_EXTRA_CA_CERTS` to every child. When its temp CA cert is
  cleaned up, *all* outbound HTTPS from claw fails with `unable to get local
  issuer certificate`, which the LLM client reports as the generic
  `"Connection error."` — zero tokens, empty content, runs still marked
  `completed`. pmg guards `pnpm install`; do not wrap `pnpm run dev` in it.
- **A run that fails every LLM turn still finalizes as `status: completed`**
  with a zero-length result. That is why the above presented as "agents do
  nothing" rather than an error. Worth fixing independently.
- **The LiteLLM grid's team allowlist does not include `claude-sonnet-5`.** An
  agent pinned to it that loses its direct-Claude creds falls back to `spaces`
  carrying that model name and 403s on every call. Allowed ids include
  `claude-sonnet-4-6`, `claude-opus-4-6`, `kimi-latest`.
