# Artifact Apps — Lifecycle, Versioning & Collaboration Plan

> M1–M5 shipped in PR #855 (**merged to `main` as `11a759adb`**): `create-app`
> tool, Sandpack rendering, live reads (`useXyneData`), writes
> (`useXyneMutate`), agent invocation (`useXyneAgent`), save/publish, and
> host-side name resolution (`useXyneDirectory`).
>
> **Steps 1, 3 and 6 are shipped** — one app per conversation, version restore,
> and the App Creation mode split view — plus the sandbox boot loader. Steps 2, 4
> and 5 remain planned: in-place updates, collaborative creation, and fork /
> change-requests. **Step 2 is next**; see "What is next" under Sequencing.

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

## Step 3 — Restore version ✅ **SHIPPED 2026-09-01**

**Goal:** requirement 3 — one click back to any earlier iteration, same app.

### Why a head *pointer* and not a copy

`@@unique([appId, contentHash])` (the dedup rule) makes "insert an old version
again as a new row" impossible by design. A pointer sidesteps it: restore never
duplicates content, it just declares which immutable version is current.

### Backend

- `POST /artifact-apps/:id/restore { versionId }` — owner (later: collaborator)
  only; validates the version belongs to the app; sets `headVersionId`.
  Restoring to the version that is *already* head returns the app unchanged
  rather than 400: the caller asked for a state that holds, and logging it
  would put an event in the transcript that explains nothing.
- Deliberately does **not** touch `publishedVersionId`. Head is what the owner
  and the agent work on; the pin is what everyone else sees, so rolling back a
  draft must never silently republish.
- `artifact_app_restores` — **the audit trail, and the reason restore is
  legible at all.** The move is a pointer write, so afterwards a restored app is
  byte-for-byte indistinguishable from one that was always on that version:
  nothing in `artifact_app_versions` changes and no chat message is written.
  Without this row, a thread whose newest generation is v5 while the pane shows
  v2 has no explanation anywhere in it. Written in the **same transaction** as
  the head move — a head that moved without its event is exactly the silent
  rollback the table exists to prevent — and carrying `fromVersionId` /
  `fromVersionNumber`, since the pointer no longer records what was left behind.
- **Not modelled as a `chat_messages` row**, though those live in the same
  database and would have been ordered and replayed for free. Chat messages form
  the branching tree the transcript projects (`parentId`, sibling pagers,
  regenerate): a non-conversational node there would become a selectable branch,
  and would need a third value in a role column the client models as
  `user | assistant` — a change that ripples through every Ask AI surface.
- `GET /:id` returns `restores` oldest-first, **owner only**. Restore history
  names versions a non-owner is never served and describes edits behind the
  published pin; non-owners get `[]` so the thread renders identically whether
  the app has no events or the caller has no right to them.
- Reads: **already done in Step 1** — the owner payload route serves
  `requestedVersionId ?? headVersionId ?? publishedVersionId`; non-owner
  behaviour unchanged (pinned published version only).
- Step 2's update mode bases on head — so after a restore, "now add X" edits
  the restored iteration, which is exactly what a user means.

### UI — three surfaces, one verb

- **The pane's version dropdown** (`ArtifactAppPane`) — every non-current row
  carries a Restore control. Selecting a row only *previews*; restoring moves
  head. Two verbs on one row, hence the nested control and the
  `stopPropagation`, so restoring never reads as "view".
- **The transcript card** (`ArtifactPaneReference`) — this is where restore is
  actually discoverable. A dropdown row inside a header chip is about as hidden
  as an action gets, whereas scrolling the thread is already how you navigate an
  app's history. The card is a `div` holding two sibling buttons rather than one
  big button: viewing moves the pane, restoring moves head on the server, and
  nesting the second inside the first would be invalid markup *and* would make
  the durable verb reachable by a stray click on the card.
- **`ArtifactRestoreNotice`** — the event itself, rendered in the transcript at
  the point in time it happened. Centred and chromeless, so it reads as
  something that happened *to* the thread rather than something someone said in
  it. **Not interactive**: it is a log entry, and every version in the thread
  already has a card that selects it, so making the event selectable too would
  add a second, weaker route to the same place and invite it to be read as an
  action rather than a fact. It therefore subscribes to nothing and does not
  re-render when the viewed version changes.

Merging is by **anchoring**, not concatenation: each event attaches to the last
message whose timestamp precedes it, and renders after that bubble. The render
loop stays driven by `displayMessages` alone, so branch selection, sibling
pagers and bot-turn indices keep counting messages and only messages. The
bubble's key moved to the wrapping keyed `Fragment`, which preserves the
"don't remount when the id swaps temp→server" property that keeps the
live→done reasoning transition from hard-swapping.

Events come from `AppCreationModeSignal`, not from props, so they **survive
closing the pane** — history that vanishes when a panel is dismissed is not
history.

Icon is `RotateLeft` from `@xyne/icons` on all three surfaces (it replaced
lucide's `RotateCcw` in the dropdown for consistency).

### The card's weight — settled by two wrong answers

Worth recording, because both extremes were tried and both were wrong.

The card began as a bordered box holding a tiled icon and an outlined Restore
button: **three nested rectangles**, competing with the app they point at, which
is already on screen a few hundred pixels to the right. Stripping all of it —
borderless, unfilled, one line — went too far the other way: it blended into the
answer text and stopped reading as an object at all.

What works is **one soft filled surface**, no border and no inner tile. The fill
is what separates it from the paragraph above, so it does not need an edge to do
that job as well. "View" was deleted outright: the row itself is the click
target, so the affordance is the hover state, and that removed a control and a
border together.

One prop, `fill`, carries **both** the scale and the surface, because they always
move together — the panel fills `--background` and wants a bigger mark, the
inline card sits on `--card` and wants a smaller one. Those two tokens are the
same white in light mode but `#1A1A1F` vs `#22232A` in dark, so an overlay or
card hard-coded to either shows as a wrong-shade rectangle inside the other. It
stays a plain boolean so `ArtifactSandpack`'s shallow-compare memo holds and the
iframe is never torn down for it.

### A duplicate the card exposed

Every generated app was rendering **twice**: once as the running app, and again
underneath as `artifact.json (click to download)` — the raw bytes of the thing
directly above it. `MessageReactArtifacts` renders artifacts, and the generic
bot-attachment list rendered them a second time. Assistant attachments now
filter through `toArtifactRef`, the same predicate that component selects on, so
the two cannot disagree. Non-artifact attachments (generated PDFs and so on) are
untouched.

### Verification

v1→v2→v3, restore v1 → head=v1, card shows v1, agent update produces v4 based
on v1 (v2/v3 still in history). Published pin untouched by restore. The thread
shows "Restored to Version 1 from Version 3" at the point it happened, still
there after a reload and after closing the pane. Restoring to current is a
no-op and adds no line.

Verified in the database rather than by eye: the restore route's writes were
exercised inside a rolled-back transaction, and two genuine events written by
the running server through the real HTTP path were read back with correct
`from`/`to` version numbers.

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

## Step 6 — App Creation mode (persistent split view) ✅ **SHIPPED 2026-08-31**

**The v0 / Lovable / Replit shape.** Chat on the left, the app itself persistent
on the right, versions switchable from a dropdown.

Before this, the app was a card inside the transcript and "expand" was a
**modal** (`ReactArtifactDialog`) — backwards for a build session: the thing you
iterate on disappeared behind the thing you type into, and every open/close
remounted the Sandpack iframe. Step 1 made a conversation own exactly one app,
which is what makes a single persistent pane unambiguous rather than "which
artifact does the right side mean?".

### What shipped

| File | Role |
|---|---|
| `AIShell.tsx` | optional `rightPanel` → third Panel; `panelIds` for the conditional tree |
| `useAppCreationMode.ts` | which app, which version, is the mode on; owns the URL param |
| `ArtifactAppPane.tsx` | supplies `titleSlot` + `onClose` to `ReactArtifactView fill` |
| `appCreationModeContext.ts` | tells transcript cards the app is already on screen |
| `ArtifactPaneReference.tsx` | what a card becomes instead of running a second copy |
| `AIChatThread.tsx` | reports the thread's `appId` + newest `versionId` upward |
| `AIScreen.tsx` | holds the state, provides context, passes the pane |
| `topBarHeight.ts` | `TOP_BAR_HEIGHT_CLASS` — the 52px every top bar shares |

It is **composition, not new infrastructure**: `AIShell` was already a
`ResizableGroup`, `react-resizable-panels@4` already had collapsible panels, and
`ReactArtifactView fill` is what the modal already used.

### Three corrections to the original plan

The plan was wrong in three places, each found by shipping it:

1. **One `autoSaveId`, plus `panelIds` — not a second `autoSaveId`.** The plan
   said the mode should use its own persistence key. That is not how the wrapper
   works: `ResizableGroup` documents `panelIds` precisely "for groups whose
   Panels are conditional". Without it the group restores whichever layout was
   written last — a two-panel layout onto a three-panel tree — recomputes, fires
   `onLayoutChanged`, and churns. Swapping `autoSaveId` on mode change made it
   worse by re-initializing `useDefaultLayout` mid-flight. Pass `panelIds`
   (memoized; a fresh array re-initializes and reproduces the churn).
2. **Sidebar collapse is opt-in, and applied with a settle loop.** Shipped
   unconditionally, reverted, then reinstated 2026-09-01 behind the
   "Collapse sidebar when building an app" preference (default OFF,
   `useAppModeCollapseSidebar`, localStorage — same shape as
   `useAILandingDefault`). It needed both conditions the reversal named.
   Driving the panel imperatively races the group's deferred re-layout:
   `expand()` is a no-op unless the panel is collapsed *at the instant it is
   called*, so a one-shot fired in the commit where the third panel unmounts is
   clobbered a frame later and the sidebar stays shut. `AIShell` now enforces
   the intent for up to 10 animation frames against the panel's real
   `isCollapsed()`, only on a transition, so it never fights a width the user
   set afterwards. Do not replace that loop with a single call.
3. **One header row, not two.** The pane originally drew its own bar above
   `ReactArtifactView`'s, which already carries the Preview/Code tabs and saved
   state — two stacked bars showing two different titles (the app's vs
   `payload.title`, which legitimately differ once a build renames itself).
   `ReactArtifactView` now takes an optional `titleSlot` that replaces its title
   span, and the pane supplies icon + app title + version dropdown.

### The hazard that decides the implementation: two live Sandpacks

If the pane renders the app while the transcript still renders live cards, the
same app runs **twice** — two iframes, two `useXyneData` bridges, two agent
bridges, duplicate queries, and writes firing from whichever copy was clicked.
In the mode, inline cards therefore become a non-executing
`ArtifactPaneReference`: it states the version this turn produced and, clicked,
points the pane at that build. It is card-weight on purpose — scrolling a thread
is how you navigate an app's history.

Two remount rules, both learned the hard way:

- `ArtifactSandpack` is `memo`'d with a shallow compare — anything crossing that
  boundary must be a stable ref or a plain boolean, never a fresh object or
  callback. Everything the pane hands down is memoized for this reason: an
  unmemoized mode object, context value, or `rightPanel` element each re-render
  the pane and the iframe under it.
- The pane is **mounted once and kept**. A new version changes its `payload`,
  never its identity.

### State lives in the URL

`?mode=create-app` is the open/closed state, written with `{ replace: true }` so
toggling a panel does not stack history. A reload — or a pasted link — returns to
the same layout. Everything else is keyed to the CONVERSATION and reset on
switch; a version pinned in one thread is meaningless in another. The param is
stripped on a blank new chat, where there is no app for it to describe.

Auto-enter fires **once per conversation**, tracked in a ref, so an explicit
close sticks: closing marks that thread handled and a later generation reopens
nothing, while switching threads starts fresh.

### Keeping the pane fresh

The pane reads the app through the `['artifact-app', appId]` query, which is
cached. Nothing invalidated it when a generation landed, so the pane sat on the
old head until a refocus. The thread now reports the newest artifact's stamped
`versionId`; when that id is absent from the cached version list, the hook
invalidates once (guarded by a ref, not by the versions array — a version the
server has not surfaced yet would otherwise refetch forever). The Saved / "Newer
version" chips read the same key, so they were fixed by the same change.

### A routing bug this exposed

Adding the thread to the URL (`/ai/chat/:sessionId`, matching how channels
address a conversation) was first done as **two route entries** — `chat/new`
*and* `chat/:sessionId`. React Router treats those as distinct routes, so moving
between them unmounted and remounted `AIScreen`, wiping its state; the remount
re-seeded from `sessionStorage`, the URL effect navigated back, and the screen
bounced between routes. There is now **one** route with `new` as an ordinary
param value. The old `sessionStorage` restore is gone: it predated threads
having URLs and turned "new chat" into "whatever you had open last".

Two-way URL↔state sync guards on **whether its own source changed** (a ref), not
on the dep array firing — effects run in commits where the other side is still
stale, which is what made "New Chat" snap back to the previous thread.

### Deferred

Both items that used to sit here have since shipped: **restore** (Step 3, with
its own audit trail in the transcript) and the **sidebar auto-collapse
preference**. The preference is off by default; when on it fires once per app,
and only for an app generated live in this mount — an artifact loaded from
history never collapses anything, which is what `streamedMessageIds` in
`AIChatThread` exists to distinguish. It is a counter *event*, not state:
steady state re-asserts itself on every thread switch and would undo a sidebar
the user deliberately reopened.

What remains unverified is whether the pane's Sandpack survives a new version
**without remounting** — see "Open, unowned" below.

---

## Sandbox boot loader ✅ **SHIPPED 2026-09-01**

Not a numbered step — a rendering fix that Step 6 made impossible to ignore, now
that an app sits on screen for the whole conversation instead of inside a card
you scroll past.

Sandpack does not bundle in-page: the preview is an iframe served by the
CodeSandbox bundler, which must be fetched, resolve the app's dependencies and
transpile before anything paints. That is **seconds**, and what filled them was
CodeSandbox's own loader — someone else's brand, in the middle of ours.

`AppLoaderMark` is the Xyne logo + wordmark extracted out of `AppLoader` in three
sizes. `AppLoader` keeps everything else it had (fixed backdrop, `--root-bg`, the
React-Native-webview bail, the animation log) and renders the mark at `lg`.
Deliberately **static** — no pulse, no spinner.

Four things here are load-bearing and will be re-derived by anyone who touches
it:

- **`sandpack.status` is the wrong signal.** It flips to `running` the moment the
  client is instantiated, seconds before anything compiles, so an overlay keyed
  to it disappears against a blank iframe. The truth is the message stream:
  `done` means compiled and painted, and `start` with `firstLoad` means a real
  restart (not the incremental recompiles that follow, which must not throw the
  loader back over a running app). This is exactly what Sandpack's own overlay
  listens to — see `useLoadingOverlayState` in its dist.
- **The overlay is a sibling of `SandpackLayout`, not a child of
  `SandpackPreview`.** `.sp-wrapper` is already `position: absolute; inset: 0`
  from `sandpackOverrides.css`, so `inset-0` there covers *everything* Sandpack
  draws — including the bottom-left progress line and the stdout preview, which
  live outside the loading overlay and carry their own stacking.
- **`.sp-overlay.sp-loading` must be hidden**, and this is not cosmetic:
  `SandpackPreview` always renders its own overlay (there is no prop to disable
  it), and it fades out over 400ms starting at `done` while ours unmounts
  instantly — so without the rule you get a flash of the CodeSandbox loader on
  every boot. Scoped to `.sp-loading` on purpose: timeout and runtime errors use
  `.sp-error` and must stay visible. The rule lives in **both**
  `sandpackOverrides.css` and the inline `SANDPACK_FILL_CSS` copy, for the reason
  that constant already documents.
- **Timeout is left alone.** `sandpack.status === 'timeout'` returns null so
  Sandpack's error overlay and its retry button show through. Covering it would
  turn a reported failure into a loader that never ends.

The payload fetch uses the same mark, so fetching and booting read as one
continuous wait instead of a spinner handing off to a logo.

---

## Sequencing & effort

| Step | Ships | Depends on | Size |
|---|---|---|---|
| ~~1. One app per conversation~~ **done** | killed the clutter (reqs 1, 2, 4) | — | S — schema + shared hook on *both* persistence paths + card addressing |
| 2. Incremental updates | kills truncation + regressions | 1 | M — S2S read route, merge+validate in tool, `read-app-file` |
| ~~3. Restore~~ **done** | req 3 | 1 (head pointer lands with 1) | S — one route + restore-event table + three UI surfaces |
| 4. Group-DM collaboration | req 5 | 1–3 stable | M/L — re-key flow, channel-surface parity, membership ACL |
| 5. Fork + change requests | req 6 | 1–3 (4 independent) | M — two routes + CR model + review UI on existing diff view |
| ~~6. App Creation mode (split view)~~ **done** | the v0/Lovable build surface | 1 (3 folds into its dropdown) | M — `AIShell` right panel + app pane + compact inline cards |

Recommended order: **~~1~~ → ~~6~~ → ~~3~~ → 2 → 4 → 5.** Steps 1, 3 and 6 are
done. Step 3 de-risked Step 1's last-write-wins choice — there is now a recovery
path when a regenerate clobbers a good version, and the rollback is legible in
the thread afterwards rather than silently changing what the pane shows.

### What is next

**Step 2 (incremental updates) is the one to do.** It is now the largest source
of avoidable failure: every "change the header colour" regenerates the whole
project, which costs ~10–16k output tokens, truncates large apps, and reintroduces
bugs the previous iteration had already fixed. Restore softens the consequence but
does not remove the cause — you can roll back to the good build, but the agent
still cannot make a small edit. Steps 4 and 5 both assume a stable single-app
model and should wait for it.

### Open, unowned

Carried over so they are not lost — none of these block Step 2:

- **`deleteWorkspace()` has zero callers.** Conversation-scoped workspaces grow
  unbounded; something has to reap them.
- **A run that fails every LLM turn still finalizes as `status: completed`** with
  a zero-length result, so failure is indistinguishable from an empty answer.
- **Never measured:** whether the pane's Sandpack survives a new version without
  remounting. Reasoned about and coded for throughout Step 6 — the memo, the
  stable `payload` identity, the plain-boolean props — but never actually
  observed.
- **`release-20260825` cannot take the restore backport** as-is: it has neither
  `headVersionId` nor `conversationId` on `ArtifactApp`, and five of the dashboard
  files the change edits do not exist there. It needs Steps 1 and 6 backported
  first. `release-20260827` and `feature/deploy-xyneclaw` are done.

## Standing constraints (do not rediscover)

- Tool descriptions live in `xyne-claw-shared`; **`tsx --watch` does not reload
  it** — claw + claw-auth restarts are required after every description change.
- **There are no feature flags any more.** The four CAC configs
  (`react_artifact_config`, `_publish_`, `_write_`, `_agent_`) were deleted
  2026-09-01: they had shipped defaulting to `true`, so they gated nothing while
  still implying they did. Artifact apps, save/publish, writes and agent
  invocation are now unconditional. The per-app manifest flags (`payload.writes`,
  `payload.invokesAgents`) remain — those are declarations by an app about
  itself, not feature toggles. The Superposition keys may still exist
  server-side; nothing reads them.
- The wire markers `REACT_ARTIFACT_START/END` and the `metadata.reactArtifact`
  key are frozen — persisted data depends on them.
- Migrations on both DBs use the `migrate diff` / `db execute` /
  `migrate resolve --applied` path. **Never run `prisma migrate deploy` against
  either local DB.** The Spaces DB has no `_prisma_migrations` ledger at all.
  The claw-auth DB has a *partial* one — 5 records against 158 migrations —
  which is more dangerous, because it looks safe: `migrate deploy` replays from
  `init` and dies on `relation "users" already exists`, leaving a failed row
  that blocks every later migration until `migrate resolve` clears it (done
  2026-09-01; no data was lost, the failing statement was a `CREATE TABLE` that
  aborted). Apply migration SQL by hand after checking the objects actually
  exist, and re-run `prisma generate` afterwards.
- **`prisma migrate status` output is long — never read it through `tail`.**
  Doing so showed 10 pending when ~153 were, which is what prompted the
  `migrate deploy` above. The same truncation mistake invalidated a typecheck
  baseline comparison the same day. Capture full output, then filter.
- The local claw-auth DB has **no `experiment_*` tables**, so the three
  `experiment_*` migrations cannot apply there. Pre-existing, unrelated to
  artifact apps; that feature is simply not provisioned locally.
- After pulling main, run **`pnpm install`** before starting services. A pull
  that adds a dependency (e.g. `express-rate-limit`) leaves the package in the
  pnpm store but unlinked in the consuming workspace, and the service dies at
  import with `ERR_MODULE_NOT_FOUND`.
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
- **One route per screen.** Declaring `chat/new` and `chat/:sessionId` as two
  entries for the same component makes React Router remount it on every switch,
  wiping state and bouncing between routes. `new` is a param value, not a route.
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
- **`pnpm install` after every branch switch or pull**, before believing any
  typecheck or lint result. Stale workspace packages produce errors that look
  damning and are entirely phantom: ~15 "no exported member" errors from
  `@xyne/shared` in files you never touched, and a wave of
  "type that could not be resolved" lint errors against the Zero schema. Both
  cleared by an install, twice in one session. The same applies to
  `prisma generate` when a branch's schema differs — the client is generated
  from whichever schema was on disk last.
- **The pre-commit hook cannot run without a TTY.** `.husky/pre-commit` line 6 is
  `exec < /dev/tty`, so in any non-interactive shell it aborts before running a
  single check — it does not fail, it cannot start. Its real checks (gitleaks on
  staged, `validate-workspace-id.sh`, `change-analysis.sh`,
  `validate-schema-migrations.sh`, the enum guard, and a dashboard
  `lint:errors-only` fallback) can all be run by hand.
- **Squash merges make `git merge-base --is-ancestor` lie about backports.** It
  reports NO for a branch whose content is fully merged, because the squash
  commit is a different object. Check for the *content* — a migration directory,
  a symbol in a file — not for ancestry.
- **GitHub lags behind a force-push.** After rebasing and force-pushing, an open
  PR can keep its old `head.sha` for a minute or more and go on showing a stale
  conflict banner computed against the pre-rebase commit. Confirm locally with
  `git merge-tree --write-tree <base> HEAD` before believing it; `mergeable_state`
  `dirty` means conflicts, `blocked` means only checks and review are pending.
