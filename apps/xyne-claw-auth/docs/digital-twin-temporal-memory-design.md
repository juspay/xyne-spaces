# Temporal Memory: derived fact-threads, a version pager, and honest provenance for the Digital Twin

> Status: **proposal — not implemented.** Generated from a code-grounded investigation of this repo.

## Why this shape

The user's mental model — one memory with a time dimension you page through — is the right model. It is not the model this codebase implements, and it cannot be faked on top of what Hindsight gives us.

Today, "manager is A" and "manager is B" are two independent, simultaneously-live rows. Retain is append-only by an explicit 2026-07-17 decision (`routes/memory.ts:412-418`: "Facts now ACCUMULATE… review.replacesMemoryId is ignored"); `HindsightRetainItem` has no supersession field; hygiene and retention both hard-refuse the twin bank; and hygiene would keep the *oldest* row as canonical anyway. Hindsight does return `occurred_start`/`occurred_end` per fact, but `mapMemory` (`hindsight.ts:664-678`) throws them away and the `Memory` type has nowhere to put them. There is no history API. So the version chain has to be *derived and persisted by us*, in our Postgres, on top of three things Hindsight does give us reliably: true event timestamps, a per-memory semantic/entity/temporal link graph with weights, and tags that survive a retain round-trip.

Two things I found while verifying that change the shape of the work, and one of them is a blocker the brief did not anticipate:

**`UserMemoryCandidate.hindsightMemoryId` is always null.** `retain` is called with `async: true` (`hindsight.ts:275`), so Hindsight returns an operation id and no memory ids; `out?.[0]?.id` is always undefined. Both approve paths say so in their own comments ("Hindsight's retain returns no id… the (always-null) candidate.hindsightMemoryId", `digital-twin.ts:1006-1008`). That means **today there is no path at all from a memory row back to its `sourceRefs`** — the provenance popover in the reference screenshot has no data source until we fix the join. The fix is cheap and follows a proven precedent: `pipeline:<eventId>` tags already round-trip through retain and come back on the list response, so we add a `cand:<candidateId>` tag the same way, with an id pre-generated via `crypto.randomUUID()` before the retain call.

**Author name and avatar are dropped at ingest.** `userMemoryFetcher.ts:59` reads `searchContext.senderName` from Vespa but neither `UserMemoryRecord` nor `recordPreviews()` keeps it, and `sourceRefs` persists only `{type, id, channelId, ts}`. Also, message-type records are filtered to `senderId === userId`, so for plain messages the "author" in the popover is the user themselves — the screenshot's other-person avatar only happens for `conversation` / `mention_reply` / `call` records. Provenance therefore needs a live hydration endpoint, and it must be allowed to say "source unavailable" rather than invent a name.

My strong opinion on scope: **do not automate the destructive half.** The derivation is a guess made by an LLM over a similarity graph — good enough to *show* a timeline, not good enough to silently stop the twin from believing something. So the derived chain is a read-model. The only thing that actually changes what the twin recalls is `deleteMemory` → `PATCH state=invalidated`, which already works and is already wired to a button — and we put it behind an explicit user action in the timeline panel, with a line of copy that says plainly: *this timeline is a view; until you retire the old value, the twin can still recall "Manager: A."* That honesty is the feature. A version pager that implies the twin has forgotten A, while recall still returns A, is worse than no pager at all.

The second opinion: **exclusivity is the judgment that makes or breaks this.** "Manager is A" → "Manager is B" is a version chain. "Works with A" → "works with B" is not; those coexist. If the LLM stage does not classify the attribute as exclusive vs. coexisting, the feature will confidently invent successions out of ordinary accumulation, and users will trust it. Coexisting attributes get no pager. Unknown gets the ambiguous branch UI, never a chain.


## Design

# Temporal / Evolving Memory UX — Digital Twin

## 0. What is real today vs. what is new work

Derived from the code, not from the docstrings. The provider's own comments call observations "evolution/temporal tracking" while all three shipped UI legends call them "a near-duplicate rephrasing of a WORLD fact"; the only measured datum in the repo (2× duplication, `hindsight.ts:180-182`) supports the pessimistic reading. I design against the pessimistic reading.

### Works today — build on it, zero backend change

| Capability | Where |
|---|---|
| True **event** time on twin memories (not write time) | `pickEventTimestamp()` `userMemoryCuratorClient.ts:84-103` → `retain({timestamp})` → surfaces as `createdAt` |
| Per-memory **semantic / temporal / entity edges with weights**, user-scoped SQL-side (`all_strict`) | `getMemoryGraph` `hindsight.ts:564-600` → `GET /api/v1/digital-twin/graph` |
| Per-memory **extracted entities** | same endpoint, `node.entities[]` |
| Whole memory set already in the browser | `DigitalTwinMemoriesTab.tsx:244-270` (200/page loop) |
| **Tags survive retain** and come back on list | proven by `pipeline:<eventId>` (`routes/memory.ts:678`) |
| **Soft-invalidate** one memory | `deleteMemory` → `PATCH {state:"invalidated"}` `hindsight.ts:404-447`; already a UI button |
| `sourceRefs` `{type,id,channelId,ts}` per candidate | `schema.prisma:473` |
| Channel **name** + 300-char text preview per fed record | `DigitalTwinPipelineEvent.records` `schema.prisma:531-533` |
| An **LLM call channel with no new credentials** | `POST /internal/entity-llm/complete` (S2S), `entityLlmClient.ts` |
| Union-Find + similarity primitives to reuse | `entityExtraction/pipeline/lib/similarity.ts`, `memoryHygieneService.ts:41-100` |

### Does not exist — all net-new

| Missing | Proof |
|---|---|
| Any supersession / versioning | `HindsightRetainItem` `hindsight.ts:43-51` has content/tags/timestamp/metadata/observation_scopes and nothing else |
| Non-destructive replacement was **deliberately removed** | `routes/memory.ts:412-418` — "Facts now ACCUMULATE… `replacesMemoryId` is ignored" |
| Validity intervals | Hindsight returns `occurred_start`/`occurred_end`; `mapMemory` `hindsight.ts:664-678` drops them, `Memory` `types.ts:101-108` has no field |
| History / version API | provider surface is ensureBank/retain/recall/list/get/delete/deleteByTag/clearAll/graph×2/reflect |
| Listing observations separately | `listMemories` sends only limit/offset/q (`hindsight.ts:339-350`) |
| **memory → candidate → sourceRefs join** | `retain` is `async:true` (`hindsight.ts:275`) → returns no ids → `candidate.hindsightMemoryId` **is always null** |
| Author name / avatar for a source | `senderName` read at `userMemoryFetcher.ts:59`, never persisted |
| Channel **name** on `sourceRefs` | only `channelId` is stored |
| Anything that ages out a stale twin fact | hygiene `memoryHygieneService.ts:116-121` and retention `memoryRetentionService.ts:146-148` both hard-refuse the twin bank |

### Partial / do not rely on

- **Observations.** The twin bank is the only `enable_observations: true` bank. Hindsight *may* be synthesising "switched from A to B" rows. They carry no structure we can page through, cannot be listed by type, cannot be deleted, and the shipped legend calls them near-duplicates. **Treat as display-only garnish inside the timeline panel ("Hindsight also noted:"), never as the version source.**
- **`createdAt` provenance — verify before building.** `mapMemory` reads `date ?? created_at ?? mentioned_at`. We *pass* `timestamp` on retain; we have not proven Hindsight stores it as `date` rather than ingest time. **Ship a one-off check first**: retain a memory with `timestamp: 2023-01-04T…`, list it, assert `createdAt` comes back in 2023. If it comes back as *now*, absolute dates are wrong — but backfill deliberately walks chronologically (`digital-twin-backfill-worker.ts:255-260`), so **relative order still holds**, and the design degrades to ordinal versions with fuzzy dates ("earlier" / "later" instead of "Jan 2023 → Mar 2025"). Design for both; the version chain is built on *order*, dates are a display layer.

---

## 1. Information architecture

Nothing moves. Three additions, all inside `DigitalTwinMemoriesTab.tsx`'s existing `all` sub-tab.

```
Digital Twin › Memories
├── [Memories] [Hot] [Proposals] [Recall]        ← unchanged
├── header actions: Backfill · Refresh · Delete  ← unchanged
└── all sub-tab
    ├── constellation + scrubber                 ← unchanged
    ├── filter bar
    │   └── + NEW pill:  ⟡ Evolving (12)         ← filters to memories in a thread
    └── memories list
        └── MemoryCard
            ├── + NEW version pager (only when versions ≥ 2)
            ├── + NEW ◇ N sources chip → provenance popover
            └── + NEW ⟡ timeline chip → FactTimelinePanel (SidePanel, right)
```

One new surface: **FactTimelinePanel**, a right `SidePanel` (`ui/SidePanel.tsx`, `width={480}`, `floating`). Not a modal — the user needs the list visible behind it to compare.

**The thread is a read-model layered over the list.** One extra fetch alongside the existing `getDigitalTwinGraph` call, indexed by `hindsightMemoryId` → O(1) attach per card. No N+1.

---

## 2. The memory card

### 2a. Single-version memory — the empty state. No pager. No chrome.

This is the majority case and it must stay visually identical to today. A `1/1` pager is noise that trains users to ignore the control.

```
┌─────────────────────────────────────────────────────────────────────────┐
│ The user reports to Anurag on the Spaces platform team.                 │
│ [relationships] [WORLD]  4 recalls (7d)  created 2mo ago  why?  reasoning│
└─────────────────────────────────────────────────────────────────────────┘
```

Rule, enforced in **two** places so it cannot regress: the API never persists or returns a thread with `versions.length < 2`, and `MemoryCard` renders the pager only when `thread && thread.versions.length >= 2`.

Also suppressed: `factType === "observation"` cards never get a pager (they are derived, undeletable, and not raw facts — `isObservationType()` `DigitalTwinMemoriesTab.tsx:144`).

### 2b. Multi-version, showing CURRENT (default)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                       ┌───────────────┐ │
│ The user reports to Bhavya, who took over the         │  ‹   3/3   ›  │ │
│ Spaces platform team in March.                        └───────────────┘ │
│                                                                         │
│ NOW · since 12 Mar 2025          ◇ 2 sources        ⟡ timeline          │
│ [relationships] [WORLD]  4 recalls (7d)  why?               reasoning ⌫ │
└─────────────────────────────────────────────────────────────────────────┘
```

- Pager top-right, mono `10.5px`, matching the existing `reasoning` chip's typography. `‹` disabled at 1, `›` disabled at N.
- `NOW · since <date>` in `text-xyne-success-fg` — the only green on the card, so "this is what the twin believes" is scannable at a glance down a 25-row page.
- `◇ N sources` is the provenance trigger (hover **and** focus; click pins it open).
- `⟡ timeline` opens the panel. Present on every threaded card, including at position N.

### 2c. Multi-version, showing a PAST version

Paging left swaps the card body for the historical statement. This is the whole point of the user's model: *one card, another dimension*.

```
┌─────────────────────────────────────────────────────────────────────────┐
│▌                                                      ┌───────────────┐ │
│▌The user reports to Anurag on the Spaces              │  ‹   1/3   ›  │ │
│▌platform team.                                        └───────────────┘ │
│▌                                                                        │
│▌PAST · 4 Jan 2023 → 12 Mar 2025   ◇ 1 source        ⟡ timeline          │
│▌superseded by "reports to Bhavya" · ↩ back to current                   │
│ [relationships] [WORLD]  4 recalls (7d)  why?               reasoning ⌫ │
└─────────────────────────────────────────────────────────────────────────┘
 ▲ 2px left rail, xyne-warning-border
```

Distinguishing a superseded value — four signals, deliberately redundant:

1. **2px amber left rail** on the card body (`border-l-2 border-xyne-warning-border`, `pl-[10px]`). The strongest peripheral cue; survives a screenshot at 50% zoom.
2. **Body text at 70% opacity** (`text-xyne-fg-secondary`). *Not* strikethrough — strikethrough reads as "deleted/wrong", and a past manager was true, not wrong. This distinction matters for trust.
3. **`PAST · <from> → <until>` chip** in `text-xyne-warning-fg` where `NOW` was. Same slot, different word and colour.
4. **`superseded by "<next value>"`** — one line of `text-xyne-fg-tertiary`, plus `↩ back to current` which jumps to N (also bound to `Esc` while a past version is shown).

The chrome row (subsystem, category, recall counts, delete) does **not** dim: those belong to the memory as a whole, not the version. The delete button always acts on the *currently displayed version's* `hindsightMemoryId` — with the confirm copy adapting: *"Delete the past version 'reports to Anurag'? The current value stays."*

### 2d. Ambiguous — contradictory facts with no reliable order

Never render a chain we cannot defend. The pager is **replaced**, not augmented:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                              ┌────────────────────────┐ │
│ The user reports to Bhavya on the Spaces     │ ⑂ 2 conflicting values │ │
│ platform team.                               └────────────────────────┘ │
│                                                                         │
│ order unclear — both seen within 9 days        ⟡ resolve                │
│ [relationships] [WORLD]  2 recalls (7d)  why?               reasoning ⌫ │
└─────────────────────────────────────────────────────────────────────────┘
```

Amber chip, no arrows, no `NOW`, no implied winner. The card body keeps showing whichever value the memory list would have shown anyway (most recent `createdAt`) so nothing silently changes behind the user's back. `⟡ resolve` opens the panel in conflict mode.

### 2e. Provenance popover — matching the reference

Anchored to `◇ N sources`. Radix Popover (Tooltip is text-only; this needs interactive content and a link). `320px`, `sideOffset={6}`, `align="end"`. Opens on hover after 250ms, on focus immediately, pins on click, dismisses on outside-click / `Esc`.

```
                                    ◇ 2 sources
      ┌──────────────────────────────────────────────────┐
      │  ⬤   Anurag Sharma                               │
      │  AS                                              │
      │      handing spaces platform to bhavya from      │
      │      next sprint — she'll run standups from      │
      │      the 12th                                    │
      │                                                  │
      │  #xyne-spaces-feedback            3 JUL, 12:17 PM│
      │  ────────────────────────────────────────────────│
      │  + 1 more source            open timeline →      │
      └──────────────────────────────────────────────────┘
```

- **Avatar** — real `authorAvatarUrl` when hydration returns one, else `<Avatar name={authorName} size={28} shape="circle" />` (`ui/Avatar.tsx`, deterministic hue). Never a generic silhouette; a stable colour makes repeat sources recognisable.
- **Author name**, `12px` medium. For plain `message` records this is the user themselves — render it as **"you"** rather than their own name; pretending otherwise looks like a bug.
- **Excerpt** — 3 lines, `line-clamp-3`, `12.5px`, the message body. From live hydration; falls back to the pipeline event's 300-char `textPreview`.
- **`#channel` · timestamp** — `10.5px`, `text-xyne-fg-tertiary`, timestamp uppercase `D MMM, h:mm A` exactly as the reference (`3 JUL, 12:17 PM`).
- Footer appears only when `moreSources > 0`.
- Whole card is a link to the Spaces deep link when we can build one; plain otherwise.

**Non-message source types** get the same frame with an honest header:

```
      │  ▣   Q1 platform planning            call · 42 min│
      │      "…Anurag confirmed Bhavya takes over the     │
      │       platform team from the 12th…"               │
      │  #eng-leads                       11 MAR, 09:30 AM│
```

**Unavailable** — deleted, or outside the viewer's current ACL. Say so; never fabricate:

```
      │  ⊘   source unavailable                           │
      │      the original message was deleted or is no    │
      │      longer visible to you                        │
      │  captured                          3 JUL, 12:17 PM│
```

**No join at all** — pre-`cand:` tag memories where content matching failed:

```
      │  ⊘   provenance not recorded                      │
      │      this memory predates source linking          │
      │                              retained 2mo ago     │
```

The `◇ N sources` chip is simply not rendered in this case (no empty popover to open).

---

## 3. The expanded timeline panel

`SidePanel`, `width={480}`, `floating`, right edge. Title = the attribute label, badge = status, subtitle = subsystem + version count.

```
┌─ Manager ──────────────────────── [evolving] ──── relationships ── ✕ ─┐
│ 3 versions · derived automatically · rebuilt 2h ago                   │
│                                                                       │
│  ⬤  Bhavya Nair                                        NOW            │
│  ┃  since 12 Mar 2025 · 5 mo                                          │
│  ┃  "The user reports to Bhavya, who took over the Spaces             │
│  ┃   platform team in March."                                         │
│  ┃                                                                    │
│  ┃  ◇ #xyne-spaces-feedback · 3 Jul · Anurag Sharma          [hover]  │
│  ┃  ◇ call: Q1 platform planning · 11 Mar                    [hover]  │
│  ┃  confidence ▓▓▓▓▓▓▓░░░ 0.78 · event time · 2 memories              │
│  ┃                                                                    │
│  ┋  ⇅ CHANGED 12 Mar 2025                                             │
│  ┋     "handing spaces platform to bhavya from next sprint —          │
│  ┋      she'll run standups from the 12th"                            │
│  ┋     Anurag Sharma · #xyne-spaces-feedback · 3 Jul, 12:17 PM        │
│  ┋                                                                    │
│  ◯  Anurag Sharma                       4 Jan 2023 → 12 Mar 2025      │
│  ┃  2 yr 2 mo · 6 supporting memories                                 │
│  ┃  "The user reports to Anurag on the Spaces platform team."         │
│  ┃  ◇ #eng-general · 4 Jan 2023 · you                        [hover]  │
│  ┃  confidence ▓▓▓▓▓▓▓▓▓░ 0.91 · event time · 6 memories              │
│  ┃                                                                    │
│  ◌  before 4 Jan 2023 — not observed                                  │
│                                                                       │
│  ─────────────────────────────────────────────────────────────────    │
│  Hindsight also noted:                                                │
│  "The user's reporting line moved from Anurag to Bhavya."  OBSERVATION│
│                                                                       │
├───────────────────────────────────────────────────────────────────────┤
│ ⚠  This timeline is a view. The twin can still recall                 │
│    "reports to Anurag" until you retire it.                           │
│                                                                       │
│ [ ✓ Confirm this order ]  [ Retire past values ]  [ Not a version ]   │
└───────────────────────────────────────────────────────────────────────┘
```

Structure:

- **Vertical rail**, newest at top (matches every other feed in the product; the "now" answer is what people came for).
- **Node glyphs**: `⬤` filled = current · `◯` hollow = past · `◌` dotted = the unobserved period before the first record. That last row is deliberate — it stops "4 Jan 2023" being misread as a start date rather than a first-observation date.
- **Duration** rendered per version (`2 yr 2 mo`) — this is what makes it read as a *time dimension* rather than a list.
- **Transition blocks** (`⇅ CHANGED`) sit *between* versions and carry the single strongest piece of evidence — the message that caused the flip — inline, with author + channel + timestamp. Not hidden behind a hover. The transition is the interesting part.
- **Evidence rows** `◇ …` reuse the exact same popover component as the card, on hover.
- **Confidence** as a 10-segment bar + numeral + the time-basis word (`event time` / `write time`). A `write time` version gets a `?` icon: *"Recorded when the twin learned this, not when it happened — the position in this timeline may be wrong."*
- **Observations section** appears only when Hindsight actually produced one that mentions the same subject+attribute. Labelled, quarantined, not part of the chain.
- **Sticky footer warning.** Non-dismissable. The single most important sentence on the surface.

Footer actions:

- **Confirm this order** → `userConfirmed = true` on the thread. Removes the "derived automatically" hedge, freezes the chain against rebuild clobbering, and the card's `PAST` chip loses its dashed treatment.
- **Retire past values** → confirm dialog naming exactly what will happen, then `deleteMemory` (soft `state=invalidated`) on each past version's `hindsightMemoryId`. **This is the only action that changes what the twin recalls.** Copy: *"'The user reports to Anurag…' will stop being recalled. It stays in this timeline as history. Recall-hit stats are kept."*
- **Not a version** → the values coexist; the derivation was wrong. Deletes the thread, tombstones the pair so the next rebuild does not resurrect it, and the pagers disappear. Cheap to click, cheap to undo — this is the pressure-release valve for a heuristic feature.

### Conflict mode (ambiguous)

```
┌─ Manager ─────────────────────── [unresolved] ─── relationships ── ✕ ─┐
│ Two values, no reliable order.                                        │
│ Both were captured within 9 days and each has a single source.        │
│                                                                       │
│  ◆  "reports to Bhavya"          observed 12 Mar 2025 · 1 source      │
│     ◇ #xyne-spaces-feedback · Anurag Sharma · 12 Mar, 09:02 AM        │
│                                                                       │
│  ◆  "reports to Anurag"          observed 21 Mar 2025 · 1 source      │
│     ◇ #eng-general · you · 21 Mar, 04:40 PM                           │
│                                                                       │
│  Why we can't order these:                                            │
│  • 9 days apart — inside the 14-day noise window                      │
│  • one source each — no corroboration either way                      │
│                                                                       │
│  Which is true now?                                                   │
│   ( ) Bhavya is current — Anurag is past                              │
│   ( ) Anurag is current — Bhavya is past                              │
│   ( ) Both are true — this isn't a version chain                      │
│   ( ) Neither — delete both memories                                  │
│                                                     [ Apply ]         │
└───────────────────────────────────────────────────────────────────────┘
```

Both candidates on equal footing, no default selection, and **an explicit list of why the machine gave up**. Users forgive a system that says "I don't know, here's why"; they do not forgive one that guesses wrong silently. `Apply` writes a `userConfirmed` chain (or dissolves the thread), and the card immediately swaps from the `⑂` chip to a normal pager.

---

## 4. Data shapes (frontend contract)

```ts
// ── provenance ──────────────────────────────────────────────────────────
export type SourceKind = "message" | "call" | "canvas" | "mention_reply" | "conversation";

/** Exactly what UserMemoryCandidate.sourceRefs stores today. */
export interface MemorySourceRef {
  type: SourceKind;
  id: string;
  channelId?: string;
  ts: string;                       // ISO — event time
}

/** sourceRef hydrated for display. Every added field is nullable on purpose:
 *  the UI renders "source unavailable" rather than inventing an author. */
export interface ResolvedSource extends MemorySourceRef {
  authorId: string | null;
  authorName: string | null;        // "you" when authorId === viewer
  authorAvatarUrl: string | null;   // null → deterministic <Avatar name/>
  channelName: string | null;       // "xyne-spaces-feedback" (no leading #)
  title: string | null;             // call / canvas title
  excerpt: string | null;           // ≤ 300 chars
  deepLink: string | null;
  resolution: "live" | "snapshot" | "unavailable";
}

// ── versions ────────────────────────────────────────────────────────────
export type VersionTimeBasis = "event" | "write";

export interface MemoryVersion {
  id: string;
  /** Null only for the synthetic "before first observation" node. */
  hindsightMemoryId: string | null;
  /** The attribute value alone — "Bhavya Nair". Drives the pager label
   *  and the "superseded by" line. */
  value: string;
  /** The memory text as stored, verbatim. This is what the card body shows. */
  statement: string;
  validFrom: string;                // ISO
  validUntil: string | null;        // null ⇒ CURRENT
  /** Highest-signal source; the rest are in `sources`. */
  sourceRef: ResolvedSource | null;
  sources: ResolvedSource[];
  confidence: number;               // 0..1
  timeBasis: VersionTimeBasis;
  evidenceCount: number;            // memories collapsed into this version
  userConfirmed: boolean;
  /** Set once the user retires it — card shows a "retired" tick. */
  retiredAt: string | null;
}

export interface MemoryFactThread {
  id: string;
  subject: string;                  // "the user"
  attribute: string;                // "manager"
  label: string;                    // "Manager" — panel title
  subsystem: string;                // one of the fixed eight
  status: "evolving" | "ambiguous";
  exclusivity: "exclusive" | "coexist" | "unknown";
  /** asc by validFrom. Guaranteed length ≥ 2. */
  versions: MemoryVersion[];
  currentVersionId: string;
  /** Human-readable reasons the chain is ambiguous. Rendered verbatim. */
  ambiguityReasons: string[];
  /** Hindsight OBSERVATION rows matching this thread — display only. */
  syntheses: Array<{ hindsightMemoryId: string; content: string }>;
  userConfirmed: boolean;
  needsReview: boolean;             // a rebuild disagreed with a human decision
  derivedAt: string;
  derivedBy: "auto:v1" | "user";
}

export interface FactThreadsResponse {
  threads: MemoryFactThread[];
  /** hindsightMemoryId → threadId. The list indexes off this — no N+1. */
  byMemoryId: Record<string, string>;
  rebuiltAt: string | null;
  stale: boolean;                   // memories newer than the last rebuild
}
```

The card only ever needs: `versions.length`, the version at the pager index, and `status`. Everything else is panel-only.

---

## 5. How versions get derived

Hindsight will not supersede anything, so **we compute and persist the chain ourselves** in a new service, `twinFactThreadService.ts`. Read-model, rebuildable from scratch, never destructive.

### Inputs (all available today)

```ts
memories = <twin list path, routes/memory.ts:589-690, extracted to a callable>
graph    = memory.getMemoryGraph(TWIN_BANK_ID, { tags: [`user:${userId}`], limit: 2000 })
cands    = prisma.userMemoryCandidate.findMany({ where: { userId, status: "approved" } })
```

Excluded from thread building: `factType === "observation"` (derived, undeletable, ~2× duplicative). They are re-attached at the end as `syntheses[]`.

### Stage 1 — Provenance join (fixes the null-id blocker)

```
for each memory m:
  candId ← tag "cand:<id>"                       // NEW path, exact
  if candId → link, confidence "exact"
  else:
    eventId ← tag "pipeline:<id>"                // existing, always present post-2026-06
    pool    ← cands where pipelineEventId = eventId
    exact   ← pool.find(c => norm(c.editedText ?? c.text) === norm(m.content))
    if exact → link, confidence "exact"
    else:
      best ← argmax jaccard(tokenSet) over pool
      if best.score ≥ 0.90 → link, confidence "fuzzy"
      else                 → provenance = null   // UI says so; never fabricate
```

`norm()` = lowercase, strip the trailing `| Involving:/When:/…` metadata Hindsight appends (server-side twin of `cleanMemoryText`, `DigitalTwinMemoriesTab.tsx:120-124`), collapse whitespace, drop punctuation.

The `cand:<candidateId>` tag is added at the three retain sites by pre-generating the row id with `crypto.randomUUID()` before the retain call (the auto-approve path currently `createMany`s *after* retain, so the id must be pre-assigned — see implementation notes).

### Stage 2 — Bucketing (cheap, deterministic, no LLM)

Union-Find over memories. Union `a,b` when they share a `subsystem:` tag **and** either:

- a Hindsight `semantic` edge exists with `weight ≥ SEM_LINK_MIN` (**0.72**), or
- `jaccard(entities[a], entities[b]) ≥ ENTITY_OVERLAP_MIN` (**0.5**) with both sets non-empty.

The same-subsystem gate matters: it stops a `context` fact about the team merging with a `relationships` fact about a person.

Buckets of size 1 are dropped immediately — **this is the empty state, enforced at the source.** Buckets larger than `MAX_BUCKET` (**40**) are split by nearest-neighbour to bound the LLM prompt.

Thresholds chosen against known anchors: hygiene's duplicate threshold is 0.99 (`memoryHygieneService.ts:14`) — far too tight, "manager is A" vs "manager is B" are not 0.99-similar. Recall's `dedupeSimilar` collapses at 0.6 (`memory-search.ts:217-236`) — too loose for bucketing but a useful floor. 0.72 sits between and is over-inclusive by design: **Stage 3 is the precision filter, Stage 2 is recall.**

### Stage 3 — Attribute keying + exclusivity judgment (one LLM call per bucket)

Via `POST /internal/entity-llm/complete` (S2S, no new credentials), reusing `entityLlmClient.ts`'s schema-in-prompt + validate + repair loop (`glm-latest` corrupts `response_format`).

Request: the bucket's memory ids + cleaned texts + subsystem. Response:

```jsonc
{
  "facts": [
    { "id": "mem_1", "subject": "the user", "attribute": "manager",
      "value": "Anurag", "valueKey": "anurag" }
  ],
  "threads": [
    { "subject": "the user", "attribute": "manager", "label": "Manager",
      "memberIds": ["mem_1", "mem_4", "mem_9"],
      "exclusivity": "exclusive",
      "reason": "a person reports to one manager at a time" }
  ]
}
```

**`exclusivity` is the load-bearing field.**

- `exclusive` — only one value can hold at a time (manager, employer, job title, team, city, primary editor). → build a chain.
- `coexist` — multiple simultaneously true (collaborates with, knows, prefers, has worked on). → **no thread, no pager.** These are ordinary accumulation.
- `unknown` → `status = "ambiguous"`.

Without this stage the feature invents successions out of accumulation and does it confidently. Prompt is explicitly biased toward `coexist` on doubt.

### Stage 4 — Chain assembly (deterministic, no LLM)

```
members ← thread.memberIds sorted asc by eventTs
   eventTs   = memory.createdAt
   timeBasis = "event" if the linked candidate has sourceRefs[].ts, else "write"

collapse consecutive runs of equal valueKey into ONE version:
   validFrom     = first member's eventTs
   evidenceCount = run length
   sources       = union of the run's sourceRefs (dedup by id), sorted desc by ts

for i in 0..n-1:
   version[i].validUntil = version[i+1].validFrom     // half-open [from, until)
version[n-1].validUntil = null                        // CURRENT
version[i].supersededBy = version[i+1].id

confidence = clamp01(0.45 + 0.12 * evidenceCount)
           * (timeBasis === "event" ? 1.0 : 0.6)
           * judgeConfidence
```

A `write`-basis version may **never close** another version's interval: `memory-write.ts:92` stamps `new Date()`, so its position is unreliable. If the newest version is `write`-basis, the previous version keeps `validUntil = null` too and the thread is flagged ambiguous.

### Stage 5 — Ambiguity guards (force `ambiguous`, never guess)

Any one of these downgrades an evolving chain, and each writes a plain-English string into `ambiguityReasons[]`:

1. `exclusivity !== "exclusive"`.
2. Two adjacent versions less than `AMBIGUITY_WINDOW` (**14 days**) apart **and** both `evidenceCount === 1` → *"9 days apart — inside the 14-day noise window"*.
3. More than **40%** of members are `write`-basis → *"most of these were recorded when learned, not when they happened"*.
4. **Flip-flop**: value returns to an earlier `valueKey` (A→B→A) with `evidenceCount === 1` on each → extraction noise. With `evidenceCount ≥ 2` on each, allow it — people do move back.
5. Judge confidence below **0.6**.

### Stage 6 — Persist, preserving human decisions

Upsert on `(userId, subjectKey, attributeKey)`. **A rebuild never clobbers `userConfirmed`.** If the new derivation contradicts a confirmed thread, keep the human version and set `needsReview = true` (the panel shows *"new evidence disagrees with your confirmed order — review?"*). Tombstoned pairs (user clicked "Not a version") are skipped forever.

### Stage 7 — Enforcement is manual, always

Nothing in this pipeline calls `deleteMemory`. The only invalidation path is the user's **Retire past values** button. Rationale: the 2026-07-17 decision removed destructive updates on purpose, and hygiene/retention both hard-refuse this bank on purpose. We are not re-introducing automatic forgetting behind a heuristic — we are giving the user a reviewable one.

### Scheduling & cost

- Nightly per active twin user, after the daily curator run, via `memoryCronService.ts`.
- Incremental: on retain, mark the semantic neighbourhood dirty; rebuild only affected buckets, debounced 10 min.
- Manual: **Rebuild timelines** in the Memories header action row.
- Cost: one LLM call per bucket of size ≥ 2. A heavy user with ~2000 memories yields on the order of 60–120 buckets → a few cents nightly. Bounded by `MAX_BUCKET` and a per-user call cap (**150**).

---

## 6. States summary

| State | Card | Panel |
|---|---|---|
| 1 version | no pager, no chips — identical to today | not reachable |
| Observation (`factType`) | no pager (derived, undeletable) | not reachable |
| ≥2 versions, current | `‹ N/N ›`, green `NOW · since …` | chain |
| ≥2 versions, past | amber rail, 70% text, `PAST · from → until`, `superseded by …`, `↩ back to current` | chain, scrolled to that version |
| Ambiguous | `⑂ N conflicting values`, no arrows, `order unclear — <reason>` | conflict mode |
| Coexisting attribute | no pager (correct — not a version chain) | n/a |
| Provenance missing | `◇` chip absent | evidence row reads "provenance not recorded" |
| Source deleted / ACL-lost | `◇` present | popover reads "source unavailable" |
| Stale (memories newer than last rebuild) | unchanged | header: "3 new memories since this was built · rebuild" |
| Rebuild running | pagers stay live (old data) | header spinner, actions disabled |
| Retired past version | version shows a `retired` tick in the pager position | struck node on the rail |

---

## 7. Accessibility & interaction

- Pager is a `role="group"` with `aria-label="Memory versions"`; arrows are real `<button>`s with `aria-label="Previous version"` / `"Next version"`; the counter is `aria-live="polite"` announcing `"version 1 of 3, past, 4 January 2023 to 12 March 2025"`.
- `←` / `→` page when the card has focus; `Esc` returns to current.
- Provenance popover opens on focus, not hover alone.
- Amber rail is never the only signal — the `PAST` word and the date range carry it for colour-blind users.
- Card height is stabilised (`min-h`) across versions so paging does not reflow the 25-row list.


## Implementation notes

## Build order

Phase 1 unblocks everything else and is worth shipping alone (it makes the existing Proposals "3 sources" count clickable).

---

### Phase 0 — Verify the timestamp assumption (half a day, do this first)

Retain one memory into a scratch bank with `timestamp: "2023-01-04T10:00:00Z"`, list it, assert `createdAt` returns 2023 and not now. `mapMemory` (`packages/xyne-claw-shared/src/memory/providers/hindsight.ts:664-678`) reads `date ?? created_at ?? mentioned_at`; we pass `timestamp` on retain (`hindsight.ts:262`) but the repo never proves Hindsight stores it as `date`. If it fails, absolute validity dates are unusable — fall back to ordinal versions ("earlier"/"later"), which still works because backfill ingests chronologically (`apps/xyne-claw-auth/backend/src/queue/digital-twin-backfill-worker.ts:255-260`).

While there, send `type=observation` on `listMemories` and see whether Hindsight honours it — the comment at `hindsight.ts:339-341` says it supports `type` and `consolidation_state` but we never pass them. If it works, `syntheses[]` becomes a direct query instead of a client-side `factType` filter.

---

### Phase 1 — Provenance join + hydration

**`packages/xyne-claw-shared/src/memory/providers/hindsight.ts`**
- `mapMemory` (~:664): also surface `occurred_start` / `occurred_end` / `proof_count` when present.
- `types.ts:101-108` `Memory`: add `occurredStart?: string; occurredEnd?: string; proofCount?: number`. Free per-fact validity interval when Hindsight populates it — used as a cross-check on our derived `validFrom`, never as the sole source.

**Add the `cand:<id>` tag at all three retain sites.** Pre-generate the candidate id with `crypto.randomUUID()` (no cuid/uuid dep in `apps/xyne-claw-auth/backend/package.json`; Node's global crypto is fine, and Prisma accepts an explicit `id`).

- `apps/xyne-claw-auth/backend/src/services/userMemoryCuratorClient.ts:336-358` — assign `id: randomUUID()` when building `candidateRows`; at the auto-approve retain (`:441-446`) push `` `cand:${row.id}` `` into `tags`. The row is inserted by `createMany` at `:476` *after* the retain, so the id must be pre-assigned — this is the actual change, not just an extra tag.
- `apps/xyne-claw-auth/backend/src/routes/digital-twin.ts:1000-1020` (cluster approve) — `` `cand:${c.id}` ``; the row already exists.
- `apps/xyne-claw-auth/backend/src/routes/digital-twin.ts:1083-1100` (patch approve) — `` `cand:${candidate.id}` ``.

**New: `apps/xyne-claw-auth/backend/src/services/twinSourceHydrator.ts`**
- `resolveSources(userId, refs: MemorySourceRef[]): Promise<ResolvedSource[]>`
- Live path: `interact()` / `search()` from `src/mcp/servers/xyne-spaces-client.ts` with the user's own Spaces auth (`resolveAuthForUser`, `userMemoryFetcher.ts:76`) — so ACL is enforced by Spaces, not by us. Batch by `type`; cap 25 refs/call.
- Snapshot fallback: `DigitalTwinPipelineEvent.records` JSON (`schema.prisma:531-533`) already carries `{id, type, ts, channelId, channelName, title, textPreview}` — gives channel name + excerpt with zero Spaces calls. Mark `resolution: "snapshot"`.
- Neither → `resolution: "unavailable"`, all display fields null.
- In-process LRU, 5 min TTL, keyed `userId:type:id`.

**Consider persisting more at ingest** (cheap, improves everything downstream): `userMemoryFetcher.ts:181-190` already reads `searchContext.senderName`/`channelTitle` but drops sender. Add `authorId`/`authorName` to `UserMemoryRecord` (`packages/xyne-claw-shared/src/memory/user-memory-types.ts:65-99`), carry them through `recordPreviews()` (`userMemoryCuratorClient.ts:257-267`) and into `sourceRefs` (`:346-352`). Backward compatible — old rows just lack the fields.

**Endpoint** — `apps/xyne-claw-auth/backend/src/routes/digital-twin.ts`, near the `/graph` handler (~:857):

```
POST /api/v1/digital-twin/sources/resolve
body  { refs: MemorySourceRef[] }        // max 25
→     { success, data: ResolvedSource[] }
```

`requireUserAuth`; refs are resolved with the *requester's* Spaces auth only.

---

### Phase 2 — Thread derivation

**Prisma** — `apps/xyne-claw-auth/backend/prisma/schema.prisma`, plus migration `prisma/migrations/20260819120000_twin_fact_threads/migration.sql`:

```prisma
model TwinFactThread {
  id            String   @id @default(cuid())
  userId        String
  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  subsystem     String
  subject       String
  subjectKey    String
  attribute     String
  attributeKey  String
  label         String
  exclusivity   String              // "exclusive" | "coexist" | "unknown"
  status        String              // "evolving" | "ambiguous" | "dissolved"
  ambiguityReasons Json?            // string[]
  needsReview   Boolean  @default(false)
  userConfirmed Boolean  @default(false)
  derivedBy     String   @default("auto:v1")
  derivedAt     DateTime @default(now())
  judgeTrace    Json?               // prompt + raw judge output, for debugging
  versions      TwinFactVersion[]
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@unique([userId, subjectKey, attributeKey])
  @@index([userId, status])
  @@map("twin_fact_threads")
}

model TwinFactVersion {
  id                String   @id @default(cuid())
  threadId          String
  thread            TwinFactThread @relation(fields: [threadId], references: [id], onDelete: Cascade)
  hindsightMemoryId String?
  candidateId       String?
  ordinal           Int
  value             String
  valueKey          String
  statement         String
  validFrom         DateTime
  validUntil        DateTime?       // null = current
  timeBasis         String          // "event" | "write"
  evidenceCount     Int      @default(1)
  confidence        Float
  sourceRefs        Json            // MemorySourceRef[]
  supersededBy      String?
  userConfirmed     Boolean  @default(false)
  retiredAt         DateTime?       // set when the user invalidated it in Hindsight

  @@index([threadId, ordinal])
  @@index([hindsightMemoryId])
  @@map("twin_fact_versions")
}
```

Add `twinFactThreads TwinFactThread[]` to `model User`.

**New: `apps/xyne-claw-auth/backend/src/services/twinFactThreadService.ts`**
```ts
export async function rebuildFactThreads(userId: string, opts?: { memoryIds?: string[] }): Promise<{ threads: number; ambiguous: number; llmCalls: number }>
export async function getFactThreads(userId: string, filter?: { subsystem?: string; status?: string }): Promise<FactThreadsResponse>
export async function getThreadForMemory(userId: string, hindsightMemoryId: string): Promise<MemoryFactThread | null>
export async function resolveThread(userId: string, threadId: string, action: ResolveAction): Promise<MemoryFactThread | null>
```
Reuse `UnionFind` from `src/services/entityExtraction/pipeline/lib/similarity.ts` and the clustering shape of `clusterDuplicateLinks` (`memoryHygieneService.ts:41-100`).

Extract the twin list logic from `routes/memory.ts:589-690` into a callable (`listTwinMemoriesForUser(userId)`) so the service is not making an HTTP call to itself. That block carries the privacy gate and the JS-side re-filter (Hindsight over-matches tag queries, incident 2026-05-25) — it must not be re-implemented.

**New: `apps/xyne-claw-auth/backend/src/services/twinFactThreadJudge.ts`**
Wraps `POST /internal/entity-llm/complete` (route lives at `apps/xyne-claw/src/routes/entity-llm.ts:24`). Copy the schema-in-prompt + `validate()` + repair-loop pattern from `src/services/entityExtraction/entityLlmClient.ts` (max 3 repairs). Prompt biased toward `coexist` on doubt.

**Env knobs** (defaults in parens): `TWIN_THREAD_SEM_LINK_MIN` (0.72) · `TWIN_THREAD_ENTITY_OVERLAP_MIN` (0.5) · `TWIN_THREAD_MAX_BUCKET` (40) · `TWIN_THREAD_AMBIGUITY_WINDOW_DAYS` (14) · `TWIN_THREAD_MAX_LLM_CALLS_PER_USER` (150) · `TWIN_THREAD_REBUILD_ENABLED` (true — ops kill switch).

**Scheduling** — `apps/xyne-claw-auth/backend/src/services/memoryCronService.ts`: nightly per opted-in user after the daily curator run. Incremental trigger on retain, debounced 10 min.

**Endpoints** — all in `apps/xyne-claw-auth/backend/src/routes/digital-twin.ts`, `requireUserAuth`, user-scoped:

```
GET  /api/v1/digital-twin/fact-threads?subsystem=&status=&limit=500&offset=0
     → { success, data: FactThreadsResponse }        // threads + byMemoryId index

GET  /api/v1/digital-twin/memories/:hindsightMemoryId/versions
     → { success, data: { thread: MemoryFactThread | null } }

POST /api/v1/digital-twin/fact-threads/rebuild
     → 202 { success, data: { jobId, processing: true } }
     mirror DeleteMemoriesModal's 202-plus-polling pattern (digital-twin.ts:673)

GET  /api/v1/digital-twin/fact-threads/rebuild/:jobId
     → { success, data: { status, threads, ambiguous } }

POST /api/v1/digital-twin/fact-threads/:id/resolve
     body { action: "confirm" | "reorder" | "dissolve" | "retire-past" | "delete-all",
            order?: string[], versionIds?: string[] }
     → { success, data: { thread: MemoryFactThread | null } }
```

`retire-past` is the only action that touches Hindsight: `memory.deleteMemory(TWIN_BANK_ID, id)` per version, then stamp `retiredAt`. Handle the two documented error markers — `HINDSIGHT_DERIVED_OBSERVATION` and `HINDSIGHT_CURATION_UNSUPPORTED` (`hindsight.ts:420-447`) — and surface them via the existing `memoryDeleteNotice()` mapping (`DigitalTwinMemoriesTab.tsx:126-140`).

`dissolve` writes a tombstone on `(userId, subjectKey, attributeKey)` so the next rebuild does not resurrect it. Simplest: keep the row with `status: "dissolved"` and skip dissolved pairs in Stage 6.

---

### Phase 3 — Frontend

**`apps/xyne-claw-auth/frontend/src/lib/api.ts`** — add near the existing twin block (~:4740-4790): the `MemorySourceRef` / `ResolvedSource` / `MemoryVersion` / `MemoryFactThread` / `FactThreadsResponse` types, plus `getDigitalTwinFactThreads`, `getMemoryVersions`, `rebuildFactThreads`, `getFactThreadRebuildStatus`, `resolveFactThread`, `resolveDigitalTwinSources`. Follow the existing `request<{success,data}>` + `x-user-id` header convention.

**New: `apps/xyne-claw-auth/frontend/src/v3/components/digital-twin/MemoryVersionPager.tsx`**
`{ thread, index, onIndex }` → the `‹ N/M ›` control, the `⑂ N conflicting values` chip, and the `NOW` / `PAST` status line. Renders `null` when `thread.versions.length < 2`.

**New: `.../digital-twin/SourceProvenancePopover.tsx`**
Radix Popover (`@radix-ui/react-popover` — `@radix-ui/react-tooltip` is already a dep, so the sibling package is a trivial add). Trigger = `◇ N sources`. Content per the mockup, using `ui/Avatar.tsx` for the fallback avatar. Lazy-loads via `resolveDigitalTwinSources` on first open; caches per ref id in a module-level `Map`. Shared verbatim by the card and the timeline panel.

**New: `.../digital-twin/FactTimelinePanel.tsx`**
`ui/SidePanel.tsx` (`width={480}`, `floating`), the vertical rail, transition blocks, confidence bars, the sticky warning footer, and the conflict-mode radio group.

**`.../digital-twin/DigitalTwinMemoriesTab.tsx`** (1287 lines — keep the edits surgical):
- `AllSubtab` (~:430): one more `useEffect` beside the `getDigitalTwinGraph` fetch (~:470) calling `getDigitalTwinFactThreads`; store `threadsById` + `byMemoryId`.
- Filter bar (~:604-668): add an `⟡ Evolving (N)` toggle pill; add `if (evolvingOnly && !byMemoryId[m.hindsightMemoryId]) return false` to the `filtered` `useMemo` (~:497-511).
- `MemoryCard` (:845-960): accept `thread?: MemoryFactThread`; hold `versionIndex` state; render `<MemoryVersionPager/>` in the right-hand action cluster (:923); when showing a past version, swap `cleanText` for `version.statement`, apply the amber rail + 70% opacity wrapper, and render the `superseded by` line; wire `⟡ timeline` to open the panel.
- Header action row (:321-352): add a fourth icon button — **Rebuild timelines** (`ClockCounterClockwiseIcon`) → `rebuildFactThreads` + poll.
- Legend (~:203): add an entry explaining derived timelines and that they do not change recall.

**`.../digital-twin/MemoryConstellation.tsx`** (optional, later): thread membership is a natural edge colour — versions of one fact could render as a chain in the graph. Out of scope for v1.

---

### Tests

- `twinFactThreadService.test.ts` — pure-function tests on the bucketing + chain assembly, mirroring `memoryHygieneService.test.ts`: A→B produces 2 versions with a closed interval; A→B→A single-evidence is ambiguous; coexisting attributes produce no thread; a `write`-basis newest version does not close the previous interval; buckets of size 1 never persist.
- Provenance join: exact-tag, pipeline+exact-content, fuzzy ≥0.90, and the no-match case returning `null` rather than a wrong candidate.
- Route tests for the privacy gate — `/fact-threads` must 403 on another user's threads, same as the list endpoint's `userTag` gate (`routes/memory.ts:589-601`).


## Risks

1. The whole time dimension rests on an unverified assumption: that Hindsight stores the `timestamp` we pass at retain as the `date` field `mapMemory` reads back. If it stores ingest time instead, every validity range is wrong. Phase 0 verifies this before any UI work; the fallback is ordinal-only versions (order survives because backfill ingests chronologically).

2. The LLM exclusivity judgment is the single point of failure. A wrong `exclusive` verdict turns ordinary accumulation ('collaborates with A', 'collaborates with B') into a fabricated succession, shown with a confident pager. Mitigations: prompt biased toward `coexist`, a low-friction 'Not a version' dismissal, and a persisted `judgeTrace` for debugging — but some false chains will ship.

3. The derived timeline does not change what the twin recalls. A user who pages to 'PAST: manager is Anurag' will reasonably assume the twin has moved on, while `recall` still returns both rows. The sticky footer warning and the explicit 'Retire past values' action are the mitigation; if that copy gets softened in review, the feature becomes actively misleading.

4. Recall-time `dedupeSimilar()` collapses hits at 0.6 token-set Jaccard keeping the higher-*ranked* copy (`memory-search.ts:217-236`). Two short facts differing only in a name sit near that threshold, so the twin can answer with the stale value even when both rows exist — and the dashboard timeline will look correct while the answer is wrong. Out of scope here, but it means the temporal UX cannot be validated by reading the dashboard alone.

5. Provenance for existing memories is best-effort. The `cand:` tag only helps memories retained after the change; older ones rely on pipeline-event + content matching, and any memory whose candidate text was edited before approval, or that predates the `pipeline:` tag, will show 'provenance not recorded'. Expect a visibly patchy first release.

6. For plain `message` sources the author is always the user themselves (the fetcher filters `senderId === userId`), so the reference screenshot's other-person avatar only appears for `conversation` / `mention_reply` / `call` records. If most of a user's memories come from their own messages, the popover will read 'you' every time and look broken relative to the mockup.

7. Live source hydration hits Spaces per popover open with the user's own credentials. A user browsing 25 cards can fan out to dozens of Spaces calls; the LRU and the snapshot fallback bound it, but this is new load on a system we do not control, and expired credentials degrade every popover to 'unavailable' at once.

8. Nightly LLM rebuild cost scales with bucket count, not memory count, but a user with thousands of tightly-clustered memories could blow past the 150-call cap and get a partially-built thread set with no visible explanation. Needs a 'partially rebuilt' state in the header that this design does not yet specify.

9. `retire-past` re-introduces destruction into a bank where it was deliberately removed on 2026-07-17. It is user-gated and soft (`state=invalidated`), but it is a reversal of a documented decision and should be reviewed by whoever made that call. Note also that Hindsight refuses to invalidate derived observations and older deployments 405 the endpoint entirely — both errors must surface as real copy, not a toast.

10. Two new Prisma models plus a migration on a table with a `User` cascade; a rebuild that misbehaves can churn thousands of rows per user per night. `updatedAt` churn on `twin_fact_threads` will be noisy in any change-data-capture or audit tooling watching that database.
