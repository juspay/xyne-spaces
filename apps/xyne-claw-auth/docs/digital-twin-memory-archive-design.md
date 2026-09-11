# Twin Memory Archive — export & re-import for the Digital Twin memories dashboard

> Status: **proposal — not implemented.** Generated from a code-grounded investigation of this repo.

## Why this shape

The dashboard already has the right home for both affordances: the header action row in `DigitalTwinMemoriesTab.tsx` (Backfill / Refresh / Delete). Export and Import belong there as two more icon buttons, not on a new page — they are lifecycle operations on the same object the row already governs, and the row is pinned above all four sub-tabs so they stay reachable from Hot/Proposals/Recall too. Export copies `SessionExportMenu.tsx` exactly (DownloadSimpleIcon trigger → click-outside dropdown → programmatic anchor click); Import copies `DeleteMemoriesModal.tsx` exactly (Dialog + phase state machine + 1.5s status polling). Nothing new is invented at the interaction level.

Three findings in the code force the shape of the format, and they are the whole design:

(1) **Hindsight rewrites stored content.** `cleanMemoryText()` exists because the provider appends `| Involving: … | When: …` to what it stores. Re-retaining `memory.content` verbatim feeds Hindsight its own annotated output and compounds it on every round trip. So a record carries `content.stored` (audit/diff) *and* `content.canonical` (what gets replayed). Canonical is the human-approved `editedText ?? text` from the joined `UserMemoryCandidate` when one exists, else `cleanMemoryText(stored)`. That makes export→import→export a fixed point.

(2) **The event timestamp is not on the wire.** `mapMemory()` collapses `date`/`created_at`/`mentioned_at` into one `createdAt` and discards `occurred_start`/`occurred_end`. The real event time — the thing `digital-twin-backfill-worker.ts` walks chronologically to build forward-evolution observations — lives only in `UserMemoryCandidate.sourceRefs`, reachable via the `pipeline:<eventId>` tag. An export that skips that join re-imports every memory stamped roughly "now" and destroys the temporal ordering the backfill was designed to produce. So export joins Postgres, and I additionally recommend a small additive change to `mapMemory` for memories with no candidate row.

(3) **Hindsight IDs cannot be preserved, and retain is re-extractive.** `retain()` sends `async: true`, so it returns an operation handle, not usable ids — which is exactly why the codebase tags memories `pipeline:<eventId>` instead of trusting `candidate.hindsightMemoryId`. Re-import necessarily mints new ids, and Hindsight re-runs LLM extraction on the content, so 1 record in ≠ 1 memory out. The design states this in the UI rather than pretending otherwise, and compensates with a per-import tag `import:<archiveId>` that makes the whole operation reversible via the existing `deleteByTag` sweep.

Duplicate handling is deliberately conservative. Exact match on a normalized content hash is the only thing auto-skipped. Near-matches use token-set Jaccard at **0.85**, chosen specifically to sit far above the 0.6 threshold `memory-search.ts:dedupeSimilar()` uses — at 0.6, "my manager is A" and "my manager is B" collide, and silently dropping the newer one is the exact failure the append-only doctrine in `routes/memory.ts:412-418` was written to prevent. Near-matches are never auto-resolved; they are shown as a diff and default to Skip, with a per-row override.

The security constraint drives the import contract: the memories list route derives *scope* from tags (`shared`, `user:<id>`), so an attacker-supplied archive with a forged `user:<victim>` tag would cross the privacy boundary that `routes/memory.ts:589-601` exists to defend. Import therefore drops every tag from the file and rebuilds the tag set server-side from a whitelist.

Scale is handled with the machinery already in the repo — `makeJobQueue()` from `queue/job-queue.ts` (the same factory behind eval-import), Redis-staged artifacts with TTL, and a cursor in `job.progress` so a pod restart resumes rather than double-writes.


## Design

## 1. Where it lives in the IA

No new page, no new sub-tab. Two icon buttons join the existing header action row in `DigitalTwinMemoriesTab.tsx:321-352`, left of Backfill, separated from the destructive Delete by the existing visual grouping.

```
┌─ DigitalTwinMemoriesTab header — shrink-0 border-b border-xyne-border px-[20px] py-[12px] ─────┐
│                                                                                                │
│  [🧠 Memories]ⓘ  [🔥 Hot]ⓘ  [📋 Proposals]ⓘ  [🔍 Recall]ⓘ          ⬇   ⬆    ⟳    ↻    🗑     │
│                                                                     └┬┘ └┬┘  └┬┘  └┬┘  └┬┘     │
│                                                        Export ───────┘   │    │    │    │      │
│                                                        Import ───────────┘    │    │    │      │
│                                                        Backfill ──────────────┘    │    │      │
│                                                        Refresh ────────────────────┘    │      │
│                                                        Delete ──────────────────────────┘      │
└────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Export** — `DownloadSimpleIcon size={13}`, opens a dropdown. Same `<Tooltip content="…" side="bottom">` + `rounded-lg border border-xyne-border bg-xyne-surface p-[6px]` button styling as its three neighbours.
- **Import** — `UploadSimpleIcon size={13}`, opens `ImportMemoriesModal`.

`UploadModal.tsx` (the `.md` curator seed) stays exactly where it is, on `ReviewPanel`. It is a *different feature* — "teach my twin from a document" — and conflating it with "restore my archive" is how users lose data. The import modal links to it in its empty state ("Have a plain `.md` about yourself instead? Use Upload document").

**Tooltips (final copy):**
- Export: `Export memories — download a re-importable archive of everything your Twin knows.`
- Import: `Import memories — restore a previously exported archive back into Hindsight.`

---

## 2. Export UX

### 2.1 The dropdown

Structurally identical to `SessionExportMenu.tsx:84-118` — `absolute right-0 top-full z-20 mt-1 w-[300px] rounded-md border border-xyne-border bg-xyne-surface shadow-xl`, rows of `font-medium` title + `text-[11px] text-xyne-fg-tertiary` subtitle, `border-t border-xyne-border-subtle` between rows, click-outside dismiss via the same `mousedown` listener attached only while open.

```
                                   ┌────────────────────────────────────────────────┐
                                   │  Full archive                       .json      │
                                   │  All 5,880 memories with provenance.           │
                                   │  Re-importable.                                │
                                   ├────────────────────────────────────────────────┤
                                   │  Current filter                     .json      │   ← only rendered when
                                   │  412 memories matching your filters.           │     sub === "all" AND
                                   │  Re-importable.                                │     filtersActive
                                   ├────────────────────────────────────────────────┤
                                   │  Readable                           .md        │
                                   │  Grouped by cluster, for humans.               │
                                   │  Not re-importable.                            │
                                   ├────────────────────────────────────────────────┤
                                   │  ☑  Include pending proposals                  │
                                   │  ☐  Include derived observations               │
                                   │      Hindsight rebuilds these on import.       │
                                   └────────────────────────────────────────────────┘
```

The two checkboxes persist in `localStorage` under `xyne.twin.export.opts`.

### 2.2 Wiring the "Current filter" option

`filtered` lives inside `AllSubtab` (`DigitalTwinMemoriesTab.tsx:426`), not the parent. Lift it with a callback + ref, not context:

```tsx
// parent
const selectionRef = useRef<{ ids: string[]; filters: ExportFilterSnapshot }>({ ids: [], filters: {} });
const [selectionCount, setSelectionCount] = useState<number | null>(null);   // null = no filters active

// AllSubtab prop
onSelectionChange?: (ids: string[], filters: ExportFilterSnapshot, active: boolean) => void;

// inside AllSubtab, after the existing `filtered` useMemo
useEffect(() => {
  onSelectionChange?.(
    filtered.map((m) => m.hindsightMemoryId),
    { search, subsystem, category, entity, from: dateFrom, to: dateTo },
    filtersActive,
  );
}, [filtered, filtersActive, onSelectionChange]);
```

The ref holds the payload (no re-render), the count state drives the menu label. When `sub !== "all"` the row is hidden.

### 2.3 Three formats, two code paths

| Menu item | Path | Why |
|---|---|---|
| Full archive `.json` | Server job | Needs `sourceRefs`, `signalScore`, persona files, candidate join — none of it is in the browser's array. |
| Current filter `.json` | Same server job, `scope: "ids"` + the id list | One envelope, one serializer, one validator. A 20k-id POST body is ~500 KB — fine. |
| Readable `.md` | Client-side `Blob` + `createObjectURL` | Instant, zero backend, and it's display data the browser already holds. |

The `.md` renderer (in `ExportMemoriesMenu.tsx`, ~40 lines):

```md
# Digital Twin memories — pradeesh.s@juspay.in
Exported 19 Aug 2026 · 412 of 5,880 memories (filtered: subsystem=projects, from 2026-01-01)

> Read-only. To restore memories into your Twin, use the .json archive.

## Projects  (118)

- Runs the twin-draft-tray workstream; owns the Ask-AI panel remount fix.
  `WORLD` · occurred 4 Mar 2026 · learned 5 Mar 2026 · 3 recalls in 7d
- …
```

### 2.4 Progress

Export is normally sub-2s. Don't punish that with a modal.

```
State 1  (0 – 1500 ms)      trigger button swaps DownloadSimpleIcon → SpinnerGapIcon (animate-spin),
                            menu closes, button disabled. No modal.

State 2  (> 1500 ms)        a compact Dialog appears (maxWidth={420}, leftOffset={100}):

      ┌── Preparing archive ─────────────────────────────────┐
      │                                                      │
      │        ◠ (SpinnerGapIcon 26, animate-spin)           │
      │                                                      │
      │        Collecting memories…                          │
      │        2,140 of 5,880 · 1.4 MB so far                │
      │                                                      │
      │        ▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░  36%                 │
      │                                                      │
      │  This runs in the background — keep this open.       │
      │                                       [ Cancel ]     │
      └──────────────────────────────────────────────────────┘

State 3  (completed)        modal closes, anchor-click fires the download,
                            Snackbar: { variant: "success",
                                        title: "Archive downloaded",
                                        description: "5,880 memories · 3.1 MB · 412 pending proposals" }

State 4  (failed)           Snackbar { variant: "error", title: "Export failed", description: failedReason,
                                       duration: 8_000 } — matches the existing memoryDeleteNotice pattern.
```

Phases reported by the job, in order: `listing` → `joining` → `serializing` → `done`. `listing` and `joining` each drive the `n of N` line; `serializing` shows an indeterminate bar (it's <500 ms).

---

## 3. The archive format

### 3.1 File

`xyne-twin-memories-<YYYY-MM-DD>.json` — a single JSON document, `Content-Type: application/json`, served with `Content-Disposition: attachment`. The server assembles it **streamed** (header written, then `"memories":[` , then chunks, then `]}`), so memory use is O(batch) not O(archive). The client parses it whole on import; that's fine up to the 50k-record cap.

### 3.2 Schema

```ts
// apps/xyne-claw-auth/backend/src/services/twinMemoryArchive.ts

export const ARCHIVE_KIND = "xyne.digital-twin.memory-archive";
export const ARCHIVE_VERSION = 1;

export interface TwinMemoryArchive {
  $schema: "https://xyne.io/schemas/twin-memory-archive/v1.json";
  kind: typeof ARCHIVE_KIND;
  version: 1;

  exportedAt: string;                       // ISO
  exportedBy: {
    userId: string;                         // origin user — informational; NEVER trusted on import
    email: string | null;
    orgId: string | null;
  };

  source: {
    app: "xyne-claw-auth";
    provider: string;                       // memory.name — "hindsight"
    bankId: string;                         // bankIdForAgent("digital-twin")
    bankConfig: { enableObservations: boolean };
    /** The exact tag shape the twin retain path uses, so an importer on a
     *  future schema can reason about what it must reconstruct. */
    tagContract: ["user:<id>", "subsystem:<s>", "scope:user", "pipeline:<eventId>?"];
  };

  selection: {
    mode: "all" | "ids";
    filters: {                              // echoed for provenance; not replayed on import
      search: string | null;
      subsystem: string | null;
      category: string | null;
      entity: string | null;
      from: string | null;                  // ISO
      to: string | null;
    } | null;
    requestedIds: number | null;            // when mode === "ids"
  };

  counts: {
    memories: number;
    derivedMemories: number;                // factType === "observation" — excluded from import by default
    candidates: number;
    personaFiles: number;
    /** Memories we could NOT join to a candidate row → no event timestamp, no sourceRefs. */
    unjoined: number;
  };

  integrity: {
    algorithm: "sha256";
    /** sha256 over the newline-joined, sorted contentHash list. Detects truncation/tamper. */
    memoriesDigest: string;
  };

  personaFiles: PersonaFileRecord[];        // soul.md, people.md, … — [] when not included
  memories: MemoryRecord[];
  candidates: CandidateRecord[];            // pending UserMemoryCandidate rows — [] when not included
}

export interface MemoryRecord {
  /** Stable within this file only. The diff UI, the commit overrides, and the
   *  failure report all key off this. Format: "m0001". */
  exportId: string;

  /** ORIGIN Hindsight id. Informational only — re-import mints a new id.
   *  Kept so a user can correlate an archive against a screenshot / support ticket. */
  hindsightMemoryId: string;

  content: {
    /** Exactly what Hindsight stores, including its "| Involving: … | When: …" tail. */
    stored: string;
    /** What gets replayed into retain(). Precedence:
     *    candidate.editedText  →  candidate.text  →  cleanMemoryText(stored)
     *  This is what makes export→import→export a fixed point. */
    canonical: string;
  };

  /** sha256 of normalizeForHash(content.canonical). The duplicate key. */
  contentHash: string;

  subsystem: string | null;                 // from the subsystem: tag — one of the 9 known clusters
  scope: "user";                            // always; a shared-scope memory is never in a twin export
  category: string | null;                  // cat:<x> tag, else factType
  factType: string | null;                  // "world" | "experience" | "observation" | "mental_model"
  derived: boolean;                         // factType === "observation"

  /** The tag array as stored. Recorded for audit. NOT replayed — import rebuilds tags. */
  tagsAsStored: string[];

  time: {
    /** EVENT time — when the fact actually happened. This is what import passes to
     *  retain({ timestamp }). Recovered from pickEventTimestamp(candidate.sourceRefs),
     *  else Hindsight's occurred_start, else null. */
    occurredAt: string | null;
    /** Hindsight learn time (mapMemory's collapsed `createdAt`). Informational. */
    learnedAt: string | null;
  };

  observationScopes: string[][];            // [["user:<originId>"]] — rewritten on import

  provenance: {
    pipelineEventId: string | null;
    candidateId: string | null;
    /** "backfill:<jobId>:<source>:<YYYY-MM>" | "daily:<date>:<source>" | "upload:<file>" */
    source: string | null;
    signalScore: number | null;
    sourceRefs: Array<{
      type: "message" | "call" | "canvas" | "mention_reply" | "conversation";
      id: string;
      channelId?: string;
      ts: string;
    }>;
  };

  /** Never imported. Kept so an export doubles as an analytics dump. */
  stats: { recallHits7d: number; lastRecalledAt: string | null };
}

export interface CandidateRecord {
  exportId: string;                         // "c0001"
  subsystem: string;
  text: string;
  editedText: string | null;
  sourceRefs: MemoryRecord["provenance"]["sourceRefs"];
  signalScore: number;
  status: "pending";                        // approved/rejected are represented as memories, not candidates
  source: string;
  pipelineEventId: string | null;
  createdAt: string;
  contentHash: string;
}

export interface PersonaFileRecord {
  name: string;                             // soul.md, people.md, …
  content: string;
  loadInPrompt: boolean;
  sortOrder: number;
  updatedAt: string;
}
```

### 3.3 `normalizeForHash` — the single source of duplicate truth

```ts
export function normalizeForHash(s: string): string {
  return s
    .normalize("NFKC")
    // same rule as the UI's cleanMemoryText — Hindsight's metadata tail is not part of the fact
    .replace(/\s*\|\s*(Involving|When|Where|Who|Related|Context)\s*:.*$/i, "")
    .toLowerCase()
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?]+$/, "")
    .trim();
}
export const contentHash = (s: string) => "sha256:" + createHash("sha256").update(normalizeForHash(s), "utf8").digest("hex");
```

Lives backend-only. The frontend never hashes — every duplicate verdict is computed server-side against the live bank, once, authoritatively. (Same doctrine as the JS-side user-tag re-filter: never let the client or the provider be the arbiter.)

### 3.4 Worked example (one record)

```json
{
  "exportId": "m0417",
  "hindsightMemoryId": "hs_01JQ4K2ZPN8T3V",
  "content": {
    "stored": "Pradeesh owns the twin-draft-tray workstream and prefers shipping behind a flag before a broad rollout. | Involving: Pradeesh | When: March 2026",
    "canonical": "Pradeesh owns the twin-draft-tray workstream and prefers shipping behind a flag before a broad rollout."
  },
  "contentHash": "sha256:9a3c1f...e70b",
  "subsystem": "projects",
  "scope": "user",
  "category": "world",
  "factType": "world",
  "derived": false,
  "tagsAsStored": ["user:usr_9Kd2", "subsystem:projects", "scope:user", "pipeline:evt_7Qm"],
  "time": { "occurredAt": "2026-03-04T09:12:00.000Z", "learnedAt": "2026-03-05T02:00:11.000Z" },
  "observationScopes": [["user:usr_9Kd2"]],
  "provenance": {
    "pipelineEventId": "evt_7Qm",
    "candidateId": "cmk3n8...",
    "source": "backfill:dt-backfill:usr_9Kd2:messages:2026-03",
    "signalScore": 0.82,
    "sourceRefs": [{ "type": "message", "id": "msg_44812", "channelId": "ch_eng", "ts": "2026-03-04T09:12:00.000Z" }]
  },
  "stats": { "recallHits7d": 3, "lastRecalledAt": "2026-08-12T11:04:00.000Z" }
}
```

### 3.5 What survives a round trip, and what does not

| Field | Survives? | Mechanism |
|---|---|---|
| Fact text | **Yes** | `content.canonical` replayed into `retain({ content })`; Hindsight re-annotates, `normalizeForHash` strips it again → stable across N round trips. |
| Event timestamp | **Yes** | `time.occurredAt` → `retain({ timestamp })`. Preserves the chronological ordering `digital-twin-backfill-worker.ts:255-260` builds evolution observations from. |
| Subsystem / cluster | **Yes** | Rebuilt as `subsystem:<s>` after whitelist validation. |
| `scope:user` | **Yes** | Server-added, never read from the file. |
| Observation scoping | **Yes** | Rebuilt as `[["user:<importingUserId>"]]` — never copied from the file. |
| Bank id | **Yes** | Server constant `bankIdForAgent("digital-twin")`; the file's value is only compared, never used. |
| `sourceRefs` / signal score / curator provenance | **Yes, in Postgres** | Restored onto the `UserMemoryCandidate` row the importer writes alongside each retain. Not visible to Hindsight — it never was. |
| `pipeline:<eventId>` deep link | **Same-user only** | Kept when the `DigitalTwinPipelineEvent` row exists and belongs to the importer; stripped otherwise. |
| **Hindsight memory id** | **NO** | Hindsight assigns ids at retain, and `retain()` runs `async: true` so it doesn't return usable ids at all (this is why the codebase tags `pipeline:<eventId>` instead of trusting `candidate.hindsightMemoryId`). The origin id is archived for correlation and nothing more. |
| **1 record → 1 memory** | **NO** | Retain re-runs LLM extraction. One record may become several facts, or merge with an existing one. |
| Derived observations | **NO — by design** | `derived: true` records are excluded from import by default. Hindsight regenerates them from the raw facts; re-importing them roughly doubles them (`hindsight.ts:180-182`, "~2x-duplicates world facts; verified experimentally"). |
| Recall-hit history | **NO** | `MemoryRecallHit` rows key off the old Hindsight id. Archived under `stats` as analytics; a fresh import starts at zero recalls. |

The import modal states items 3–6 verbatim in a collapsible "What changes on import" panel. Do not hide this.

---

## 4. Import UX

`ImportMemoriesModal.tsx` — `<Dialog maxWidth={720} leftOffset={100}>`, phase state machine exactly like `DeleteMemoriesModal`:

```ts
type Phase = "pick" | "staging" | "analyzing" | "review" | "confirm-replace" | "importing" | "done" | "error";
```

### Step 1 — Pick

```
┌── Import memories ──────────────────────────────────────────────────────────┐
│                                                                             │
│  Restore a Twin archive (.json) you exported earlier. Memories are          │
│  re-ingested into Hindsight under your account.                             │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                                                                       │  │
│  │              ⬆   Drop a .json archive here, or  [ Choose file ]        │  │
│  │                  Up to 64 MB · 50,000 memories                        │  │
│  │                                                                       │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ▸ What changes on import                                                   │
│                                                                             │
│  Have a plain .md about yourself instead? Use Upload document →             │
│                                                                             │
│                                            [ Cancel ]   [ Continue ]        │
└─────────────────────────────────────────────────────────────────────────────┘
```

Client-side gate before upload (mirrors `UploadModal.tsx:22-38`): extension must be `.json`, size ≤ `MAX_ARCHIVE_BYTES = 64 * 1024 * 1024`. Errors render in the same `rounded-lg border border-xyne-border bg-xyne-error-bg p-[10px] text-[11px] text-xyne-error-fg` block.

### Step 2 — Staging (validate)

`POST /memories/import/stage` (multipart). Server parses, validates the envelope, stores it in Redis, and immediately enqueues the analyze job — one round trip, so the modal goes straight from an "Reading archive…" spinner into Step 3.

**Rejected outright (400, phase → `error`):**

| Condition | Message |
|---|---|
| `kind !== ARCHIVE_KIND` | `This isn't a Twin memory archive. Expected a .json exported from this page.` |
| `version > 1` | `This archive was made by a newer version of Xyne (v{n}). Update, or export again at v1.` |
| `memories` not an array / missing | `Archive is malformed — the memories list is missing or corrupt.` |
| `> 50,000` memories | `Archive has {n} memories; the limit is 50,000. Export in date ranges instead.` |
| `integrity.memoriesDigest` mismatch | `Archive looks truncated or edited — the integrity digest doesn't match. Re-export and try again.` |
| any `content.canonical` > 8,000 chars | `Record {exportId} is too long (…). Twin memories are short facts.` |

**Warned, not blocked (rendered as an amber strip above the review table):**

- `exportedBy.userId !== me` → `⚠ Exported by other@company.com. Importing stores their memories as YOUR Twin's. Pipeline trace links will be dropped.`
- `source.bankId !== bankIdForAgent("digital-twin")` → `⚠ Exported from a different memory bank ({id}).`
- `exportedAt` older than 180 days → `⚠ This archive is 8 months old. Facts may have changed since.`

### Step 3 — Analyzing

```
      ┌── Import memories ───────────────────────────────────┐
      │        ◠  Comparing against your live memories…      │
      │           1,120 of 4,900 checked                     │
      │        ▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░  23%                  │
      │  Runs in the background — keep this open.  [Cancel]  │
      └──────────────────────────────────────────────────────┘
```

### Step 4 — Review & choose (the crux)

```
┌── Import memories ──────────────────────────────────────────────────────────────────┐
│  xyne-twin-memories-2026-06-02.json · exported 2 Jun 2026 by you · 4,900 memories    │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                     │
│   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐             │
│   │   3,204     │   │   1,411     │   │     68      │   │     217     │             │
│   │    NEW      │   │  DUPLICATE  │   │   SIMILAR   │   │  DERIVED    │             │
│   │ not in your │   │ exact text  │   │ close, not  │   │ observations│             │
│   │ Twin today  │   │   match     │   │  identical  │   │  (skipped)  │             │
│   └─────────────┘   └─────────────┘   └─────────────┘   └─────────────┘             │
│                                                                                     │
│  How should duplicates be handled?                                                  │
│                                                                                     │
│  ◉  Skip duplicates                                          RECOMMENDED            │
│     Import the 3,204 new memories. Leave your existing 1,411 untouched.             │
│                                                                                     │
│  ○  Import everything                                                               │
│     Re-add all 4,683 records. Your Twin will hold both copies —                     │
│     Hindsight does not merge them, and nothing prunes them later.                   │
│                                                                                     │
│  ○  Replace: delete my current memories, then import                 DESTRUCTIVE    │
│     Wipes all 5,880 live memories and pending proposals first. Use this to          │
│     restore a backup exactly. You'll be asked to save a safety export first.        │
│                                                                                     │
│  ☑ Restore 412 pending proposals into my Proposals queue                            │
│  ☐ Restore 4 persona files (soul.md, people.md, …) — overwrites current ones        │
│  ☐ Include 217 derived observations  ⓘ Hindsight rebuilds these from your facts;    │
│                                        importing them usually just duplicates.      │
│                                                                                     │
│  ▾ Review 68 similar memories individually                                          │
│  ┌───────────────────────────────────────────────────────────────────────────────┐  │
│  │  92% match · projects                                        ( ) Import  (•) Skip│
│  │  In your Twin   Ships the draft tray behind a flag before broad rollout.       │  │
│  │  In archive     Ships the draft tray behind a ~~flag~~ **feature gate** before │  │
│  │                 broad rollout.                                                 │  │
│  ├───────────────────────────────────────────────────────────────────────────────┤  │
│  │  87% match · relationships                                   (•) Import  ( ) Skip│
│  │  In your Twin   Reports to Anita on the platform team.                        │  │
│  │  In archive     Reports to ~~Anita~~ **Marcus** on the platform team.         │  │
│  │  ⓘ Same subject, different value. Importing keeps BOTH — your Twin will       │  │
│  │     know two managers. Delete the stale one afterwards if that's wrong.        │  │
│  └───────────────────────────────────────────────────────────────────────────────┘  │
│                                     [ Skip all ] [ Import all ]                     │
│                                                                                     │
│  Will import 3,204 memories + 412 proposals.                                        │
│                                            [ Cancel ]   [ Import 3,204 memories ]   │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

**Bucket definitions (all computed server-side, in the analyze job):**

| Bucket | Rule |
|---|---|
| `duplicate` | `record.contentHash` ∈ the hash set of live memories. Auto-skipped in Skip mode, never surfaced individually. |
| `similar` | Not exact, but max token-set Jaccard ≥ **0.85** against a live memory **in the same subsystem**. Surfaced with a word diff and a per-row choice. Default **Skip**. |
| `new` | Neither. |
| `derived` | `record.derived === true`. Removed from the other three buckets entirely; its own checkbox. |

**Why 0.85.** `memory-search.ts:dedupeSimilar()` collapses recall hits at 0.6 Jaccard. At 0.6, "Reports to Anita" and "Reports to Marcus" are the *same* memory — which is exactly the pair a restore must never silently drop. 0.85 keeps a reworded fact together and a changed fact apart. Similar rows are never auto-resolved either way; the second example above earns an explicit inline warning because it is the case the append-only doctrine in `routes/memory.ts:412-418` deliberately refuses to resolve automatically.

The `similar` list is capped at 200 rows of detail; beyond that the disclosure shows `Showing the 200 closest of 1,340 — the rest follow your bucket choice.`

### Step 5 — Replace confirmation (only for the destructive mode)

```
┌── Replace all memories ─────────────────────────────────────────────────────┐
│  ⚠  You are about to delete 5,880 memories and 412 pending proposals,       │
│     then import 4,683 from this archive.                                    │
│                                                                             │
│  Save a safety export first — this is the only copy of what you're          │
│  about to delete.                                                           │
│                                                                             │
│      [ ⬇ Download safety archive ]        ✓ saved 5,880 memories            │
│                                                                             │
│  Type REPLACE to confirm:   [ ______________ ]                              │
│                                                                             │
│  This can't be undone. Recall-hit history is lost for all deleted memories. │
│                                    [ Back ]   [ Delete and import ]         │
└─────────────────────────────────────────────────────────────────────────────┘
```

The primary button stays disabled until **both** the safety export has completed and the literal string `REPLACE` is typed. This is non-negotiable: replace-then-fail is the one path that can destroy data with no recovery, and the safety archive is the recovery.

### Step 6 — Importing

```
      ┌── Import memories ─────────────────────────────────────────┐
      │                                                            │
      │              ◠  Importing memories…                        │
      │                                                            │
      │       ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░  1,850 / 3,204            │
      │                                                            │
      │       Retaining · Relationships · 1,850 imported · 3 failed│
      │                                                            │
      │  Runs in the background — safe to close this and come back │
      │  from the Import button.                       [ Cancel ]  │
      └────────────────────────────────────────────────────────────┘
```

Unlike `DeleteMemoriesModal`, closing is **allowed** here. The job is durable in BullMQ; on reopen the modal reattaches to the live job (jobId cached in `sessionStorage` under `xyne.twin.import.job`). Polling every 1500 ms, the same cadence as the delete modal. Cancel sets the Redis cancel flag; the worker checks it between batches, so already-retained memories stay (and remain undoable via the import tag).

### Step 7 — Result

**Full success:**

```
┌── Import complete ──────────────────────────────────────────────────────────┐
│                              ✓                                              │
│              Imported 3,204 memories                                        │
│              Skipped 1,411 duplicates · 68 similar · 217 derived            │
│              Restored 412 pending proposals                                 │
│                                                                             │
│  ⓘ Hindsight is still extracting. New memories appear in this list over     │
│     the next few minutes — they're being processed in the background.       │
│                                                                             │
│           [ Undo this import ]      [ Refresh now ]      [ Done ]           │
└─────────────────────────────────────────────────────────────────────────────┘
```

The "still extracting" line is mandatory and not a nicety — `retain()` sends `async: true`, so a user who imports and sees an unchanged list will assume it failed and import again. Belt and braces: `Done` bumps `refreshKey`, and the modal schedules one more `refreshKey` bump 45 s later if the tab is still mounted.

**Partial success:**

```
┌── Import finished with errors ──────────────────────────────────────────────┐
│                              ⚠                                              │
│              Imported 3,116 of 3,204 memories                               │
│              88 failed                                                      │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ m0412  Hindsight retain 503: upstream unavailable                     │  │
│  │ m0413  Hindsight retain 503: upstream unavailable                     │  │
│  │ m0871  Content exceeds provider limit                                 │  │
│  │ … 85 more                                                             │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  [ Retry 88 failed ]  [ ⬇ Failure report ]  [ Undo this import ]  [ Done ]  │
└─────────────────────────────────────────────────────────────────────────────┘
```

`Retry 88 failed` re-commits from the still-staged archive with `only: ["m0412", …]` — no re-upload, because the staged archive lives 24 h in Redis. The failure report is a `.json` of `{ archiveId, failures: [{ exportId, contentPreview, reason }] }`.

---

## 5. Failure and recovery matrix

| Failure | Where it surfaces | Recovery |
|---|---|---|
| Bad / truncated / foreign file | Step 2, before anything is written | Rejected with a specific message; nothing touched. |
| Analyze job fails (Hindsight list 5xx) | Step 3 → `error` | `Couldn't read your current memories to compare. Retry, or import without comparing (imports everything).` The second option skips analysis and commits with `policy: "all"`. |
| Retain fails on a batch | Counted in `progress.failed`, first 20 reasons kept | Retry-failed-only, or download the failure report. |
| Job crashes / pod restarts mid-import | BullMQ `attempts: 2` re-runs it | Worker resumes at `progress.cursor`; already-retained records are skipped by index, so no double-write. |
| User closes the tab mid-import | — | Job keeps running. Reopening the Import button reattaches to the cached jobId and shows live progress. |
| **Import made things worse** | Result screen | `Undo this import` → deletes every memory tagged `import:<archiveId>` (JS-filtered to the requester's `user:<id>` tag before any delete). Restored candidates are deleted by `source = "import:<archiveId>"`. |
| Replace wiped everything and import then failed | Result screen | The safety archive was already downloaded in Step 5 — re-import it. This is the entire reason that gate exists. |
| Duplicates imported by mistake | Memories list | Undo the import, or delete individually with the existing trash affordance. |
| Redis staged archive expired (>24 h) before retry | Retry button | `This archive is no longer staged. Upload the file again.` Button switches back to Step 1. |

---

## 6. Security invariants (import)

These are requirements, not suggestions — the memories list route derives *scope* from tags (`routes/memory.ts:660-679`), so a forged tag is a privacy-boundary crossing.

1. **Every tag in the file is discarded.** `tagsAsStored` is archived for audit and never replayed. The importer builds the tag array itself:
   ```ts
   const tags = [
     `user:${requesterId}`,                                  // from the verified session, never the file
     `subsystem:${validSubsystem}`,                          // whitelisted against the 9 known clusters
     "scope:user",
     `import:${archiveId}`,                                  // the undo handle
     ...(keepPipelineLink ? [`pipeline:${eventId}`] : []),   // same-user + row exists
   ];
   ```
2. **`observationScopes` is always `twinObservationScopes(requesterId)`.** Never copied from the file — a forged scope would leak one user's facts into another's observation consolidation on the shared bank.
3. **`subsystem` must be one of** `style | triage | expertise | projects | relationships | preferences | decisions | context | docs`. Unknown → coerce to `context`, count it in a `coercedSubsystems` warning.
4. **`pipeline:<eventId>` is kept only when** `exportedBy.userId === requesterId` **and** a `DigitalTwinPipelineEvent` with that id and `userId = requesterId` exists.
5. **All eight endpoints mount on `digitalTwinRouter`**, i.e. behind `requireUserAuth` (cookie-only, no S2S, no admin elevation — `main.ts:304`). Job ids are namespaced `twin-export:<userId>` / `twin-import:<userId>:<archiveId>`, and every status/download/cancel handler re-checks that the job's `data.userId === requesterId` before returning anything.
6. **The download route never trusts the jobId alone** — a guessed id belonging to another user 404s.

---

## 7. Endpoints

All on `digitalTwinRouter`, base `/claw/api/v1/digital-twin`. All responses use the house `{ success, data }` / `{ success:false, error }` envelope.

### Export

```
POST /memories/export                                                        → 202
  body {
    scope: "all" | "ids",
    ids?: string[],                       // hindsightMemoryIds, ≤ 20000, required when scope="ids"
    filters?: { search, subsystem, category, entity, from, to } | null,   // echoed into the envelope
    include?: { candidates?: boolean, personaFiles?: boolean, derived?: boolean }  // defaults: true, true, false
  }
  200/202 { success: true, data: { jobId: "twin-export:usr_9Kd2" } }
  409     { success: false, error: "An export is already running", code: "EXPORT_IN_FLIGHT",
            data: { jobId } }
  400     ids required / too many ids

GET  /memories/export/jobs/:jobId                                            → poll
  200 { success: true, data: {
          jobId, state: "waiting"|"active"|"completed"|"failed",
          progress: { phase: "listing"|"joining"|"serializing"|"done",
                      total: number, processed: number, bytes: number },
          failedReason?: string } }
  404 unknown job / not yours

GET  /memories/export/jobs/:jobId/download                                   → the file
  200 application/json
      Content-Disposition: attachment; filename="xyne-twin-memories-2026-08-19.json"
      Content-Length: <bytes>
      X-Twin-Archive-Memories: 5880
      (streamed from the staged artifact; single-use is NOT enforced — re-download within the TTL is fine)
  404 { success: false, error: "Export expired — run it again", code: "ARCHIVE_EXPIRED" }
  409 job not completed yet

POST /memories/export/jobs/:jobId/cancel                                     → 200 { data: { cancelled: true } }
```

### Import

```
POST /memories/import/stage                                                  → 202
  multipart/form-data; field "archive" = the .json file (multer.memoryStorage, limits.fileSize 64 MB)
  200 { success: true, data: {
          archiveId: "arc_01JQ…",          // ttl 24h
          jobId:     "twin-import:usr_9Kd2:arc_01JQ…",   // the ANALYZE job, already enqueued
          summary: {
            version: 1, exportedAt, exportedBy: { userId, email },
            sameUser: boolean,
            counts: { memories, derivedMemories, candidates, personaFiles },
            warnings: string[]             // foreign exporter, stale archive, coerced subsystems, …
          } } }
  400 malformed / wrong kind / digest mismatch / too many records   (code: ARCHIVE_INVALID | ARCHIVE_TOO_LARGE | ARCHIVE_VERSION)
  413 body over 64 MB

GET  /memories/import/jobs/:jobId                                            → poll (analyze AND commit)
  200 { success: true, data: {
          jobId, archiveId, state,
          progress: {
            phase: "analyzing" | "deleting" | "retaining" | "restoring-candidates" | "done" | "cancelled",
            total, processed,
            // analyze result (present once phase passes "analyzing")
            buckets?: { new: number, duplicate: number, similar: number, derived: number },
            similar?: Array<{ exportId, subsystem, incoming: string, existing: string,
                              existingId: string, similarity: number }>,   // ≤ 200
            // commit counters
            imported?: number, skipped?: number, failed?: number, deleted?: number,
            candidatesRestored?: number,
            errors?: Array<{ exportId: string, reason: string }>,           // ≤ 20
            cursor?: number
          },
          failedReason?: string } }

POST /memories/import/:archiveId/commit                                      → 202
  body {
    policy: "skip-duplicates" | "import-all" | "replace",
    includeDerived?: boolean,              // default false
    restoreCandidates?: boolean,           // default true
    restorePersonaFiles?: boolean,         // default false
    similarOverrides?: Record<string, "import" | "skip">,   // exportId → choice
    only?: string[],                       // retry path: commit ONLY these exportIds
    confirmReplace?: "REPLACE"             // required when policy === "replace"
  }
  200 { success: true, data: { jobId } }
  400 confirmReplace missing for replace / unknown policy
  404 archive expired          (code: ARCHIVE_EXPIRED)
  409 an import is already running for this user

POST /memories/import/jobs/:jobId/cancel                                     → 200 { data: { cancelled: true } }

POST /memories/imports/:archiveId/undo                                       → 202
  { success: true, data: { jobId } }
  Deletes memories carrying tag `import:<archiveId>`, JS-filtered to `user:<requesterId>`
  before any delete (same authoritative-scoping doctrine as the range delete at
  digital-twin.ts:715-735). Also deletes UserMemoryCandidate rows with
  source = `import:<archiveId>`. Progress reported through the same job-status route.
```

**Job status shape** is `JobStatus<TProgress>` straight out of `queue/job-queue.ts` — `{ jobId, state, progress, failedReason? }` — so the routes are three-liners like `routes/evals/import.ts:181-193`.

---

## 8. Concurrency, limits, throughput

| Knob | Value | Rationale |
|---|---|---|
| One export job per user | jobId `twin-export:<userId>` | Same dedupe trick as `digital-twin-backfill-queue.ts:jobIdFor`. |
| One import job per user | jobId `twin-import:<userId>:<archiveId>` | Prevents two commits racing on the same bank. |
| Staged artifact TTL | export 1 h, import 24 h | Import's is long because retry-failed-only must not need a re-upload. |
| Max archive bytes | 64 MB (multer `limits.fileSize`) | Under the global `express.json` 50 MB limit is irrelevant — multipart bypasses it. |
| Max memories per archive | 50,000 | ~20 MB of JSON; the browser can still `JSON.parse` it. |
| Max canonical length | 8,000 chars | The curator prompt caps memories at 2–4 sentences (`user-memory-curator.ts:246`); 8k is a generous abuse ceiling. |
| Export artifact cap | 64 MB gzip → job fails `ARCHIVE_TOO_LARGE` | Message: `Too much to export at once — use the date filter and export in ranges.` |
| Retain batch | 25 items/call, concurrency 3 | Note the existing approve paths retain **one item per call** in a serial loop (`digital-twin.ts:1013`); the importer must batch or 5k memories takes 80 minutes. Batched: ~200 calls ≈ 70 s. |
| Delete concurrency (replace/undo) | `mapPool(targets, 8, …)` | Reuse the helper already at `digital-twin.ts:113-124`. |
| Progress write | once per batch | ~200 `updateProgress` calls per import — cheap. |
| Poll cadence | 1500 ms | Matches `DeleteMemoriesModal`. |

---

## 9. Sequence

```
EXPORT
  UI ──POST /memories/export {scope,include}──────────────► route
                                                            └─ enqueue twin-export job → 202 {jobId}
  UI ──GET  …/jobs/:id (1.5s) ───────────────────────────► progress {phase, processed, total, bytes}
                        worker: listMemories(wide, tag) → JS re-filter to user:<id>
                                → join UserMemoryCandidate on pipelineEventId (+ contentHash fallback)
                                → stream-serialize envelope → gzip → Redis SETEX 3600
  UI ◄── state "completed" ───  anchor.click(…/jobs/:id/download)  → file lands
                                Snackbar "Archive downloaded · 5,880 memories · 3.1 MB"

IMPORT
  UI ──POST /memories/import/stage (multipart) ──────────► parse+validate → Redis SETEX 86400
                                                            └─ enqueue analyze job → {archiveId, jobId, summary}
  UI ──GET  …/import/jobs/:id (1.5s) ────────────────────► phase "analyzing" → buckets + similar[]
  UI  ▸ user picks policy + per-row overrides
  UI ──POST /memories/import/:archiveId/commit ──────────► enqueue commit job → 202 {jobId}
  UI ──GET  …/import/jobs/:id (1.5s) ────────────────────► phase deleting → retaining → restoring-candidates → done
                        worker: [replace? deleteByTag(user:<id>) + wipe candidates]
                                → for each batch of 25:
                                    tags rebuilt server-side, observationScopes = [[user:<me>]]
                                    memory.retain(TWIN_BANK_ID, items)
                                    prisma.userMemoryCandidate.createMany(status:"approved",
                                                                          source:"import:<archiveId>")
                                    progress.cursor = i     ← resume point
  UI ◄── result screen: Undo / Retry failed / Failure report / Refresh
```

The `UserMemoryCandidate` write alongside each retain is what restores `sourceRefs`, `signalScore`, and `source` — the provenance Hindsight never held. It also means the next export of the same memory can rejoin and recover its event timestamp, which is what closes the round-trip loop.


## Implementation notes

## New frontend files

**`apps/xyne-claw-auth/frontend/src/v3/components/digital-twin/ExportMemoriesMenu.tsx`** (~220 lines)
Structural clone of `apps/xyne-claw-auth/frontend/src/v3/components/ui/SessionExportMenu.tsx` — same `useRef` + `mousedown` click-outside effect, same `absolute right-0 top-full z-20 mt-1 rounded-md border border-xyne-border bg-xyne-surface shadow-xl` dropdown, same programmatic-anchor download helper (lines 53-67 there). Differences: `w-[300px]`, two persisted checkboxes, an inline spinner on the trigger, and the delayed progress `<Dialog>`. Contains the client-side `.md` renderer (Blob + `URL.createObjectURL` + `revokeObjectURL`).

Props:
```ts
interface Props {
  userId: string;
  totalCount: number;
  /** null when no filters are active or sub !== "all" — hides the middle row. */
  selection: { ids: string[]; filters: ExportFilterSnapshot; count: number } | null;
  /** Full in-memory array, for the client-side .md path. */
  memories: MemoryBankMemory[];
}
```

**`apps/xyne-claw-auth/frontend/src/v3/components/digital-twin/ImportMemoriesModal.tsx`** (~520 lines)
`<Dialog maxWidth={720} leftOffset={100}>` with the `Phase` state machine described in the design. Reuses `Button`, `useSnackbar`, and the `1500 ms setInterval` polling shape from `DeleteMemoriesModal.tsx:78-100`. Caches the live jobId in `sessionStorage` (`xyne.twin.import.job`) so closing and reopening reattaches. The word-diff for similar rows is a ~30-line LCS over whitespace tokens — no dependency.

Props: `{ userId, open, onClose, onImported }` — `onImported` bumps the parent's `refreshKey`, identical to `DeleteMemoriesModal`'s `onDeleted`.

## Frontend edits

**`.../digital-twin/DigitalTwinMemoriesTab.tsx`**
- Header row (`:321-352`): insert `<ExportMemoriesMenu …/>` and an Import `<Tooltip><button>` before the Backfill button. Import icon: `UploadSimpleIcon` from `@phosphor-icons/react` (already used in `ReviewPanel.tsx:234`).
- Parent (`:219`): add `selectionRef` + `selectionCount` state, `showImport` state, and mount `<ImportMemoriesModal>` beside the existing `<EnableModal>` / `<DeleteMemoriesModal>` at `:355-368`.
- `AllSubtab` (`:426`): new optional prop `onSelectionChange`, fired from a `useEffect` keyed on the existing `filtered` memo (`:507`) and `filtersActive` (`:566`).

**`apps/xyne-claw-auth/frontend/src/lib/api.ts`** — new section after `uploadDigitalTwinMd` (`:4836`), following the `request<{success, data}>` + `headers: { "x-user-id": userId }` convention:
```ts
export interface TwinExportOptions { candidates?: boolean; personaFiles?: boolean; derived?: boolean }
export interface TwinExportProgress { phase: "listing"|"joining"|"serializing"|"done"; total: number; processed: number; bytes: number }
export interface TwinImportBuckets { new: number; duplicate: number; similar: number; derived: number }
export interface TwinSimilarRow { exportId: string; subsystem: string; incoming: string; existing: string; existingId: string; similarity: number }
export interface TwinImportProgress {
  phase: "analyzing"|"deleting"|"retaining"|"restoring-candidates"|"done"|"cancelled";
  total: number; processed: number;
  buckets?: TwinImportBuckets; similar?: TwinSimilarRow[];
  imported?: number; skipped?: number; failed?: number; deleted?: number; candidatesRestored?: number;
  errors?: Array<{ exportId: string; reason: string }>; cursor?: number;
}
export interface TwinArchiveSummary {
  version: number; exportedAt: string; exportedBy: { userId: string; email: string | null };
  sameUser: boolean; counts: { memories: number; derivedMemories: number; candidates: number; personaFiles: number };
  warnings: string[];
}

export async function startTwinMemoryExport(userId: string, body: {
  scope: "all" | "ids"; ids?: string[]; filters?: unknown; include?: TwinExportOptions;
}): Promise<{ jobId: string }>;
export async function getTwinMemoryExportStatus(userId: string, jobId: string):
  Promise<{ jobId: string; state: string; progress: TwinExportProgress | null; failedReason?: string }>;
/** Anchor-clickable URL; cookie auth (clawApiBaseUrl defaults to same-origin "/claw"). */
export function twinMemoryExportDownloadUrl(jobId: string): string;
export async function cancelTwinMemoryExport(userId: string, jobId: string): Promise<void>;

export async function stageTwinMemoryImport(userId: string, file: File):
  Promise<{ archiveId: string; jobId: string; summary: TwinArchiveSummary }>;   // FormData — do NOT set Content-Type
export async function getTwinMemoryImportStatus(userId: string, jobId: string):
  Promise<{ jobId: string; archiveId: string; state: string; progress: TwinImportProgress | null; failedReason?: string }>;
export async function commitTwinMemoryImport(userId: string, archiveId: string, body: {
  policy: "skip-duplicates" | "import-all" | "replace";
  includeDerived?: boolean; restoreCandidates?: boolean; restorePersonaFiles?: boolean;
  similarOverrides?: Record<string, "import" | "skip">; only?: string[]; confirmReplace?: "REPLACE";
}): Promise<{ jobId: string }>;
export async function cancelTwinMemoryImport(userId: string, jobId: string): Promise<void>;
export async function undoTwinMemoryImport(userId: string, archiveId: string): Promise<{ jobId: string }>;
```
Note: `request()` at `lib/api.ts:91` unconditionally sets `Content-Type: application/json`. `stageTwinMemoryImport` must bypass it and call `fetch` directly with `credentials: "include"` and a bare `FormData` body, or the multipart boundary is lost.

## New backend files

**`apps/xyne-claw-auth/backend/src/services/twinMemoryArchive.ts`** (~450 lines) — the only place the format is known.
```ts
export const ARCHIVE_KIND = "xyne.digital-twin.memory-archive";
export const ARCHIVE_VERSION = 1;
export const KNOWN_SUBSYSTEMS = ["style","triage","expertise","projects","relationships","preferences","decisions","context","docs"] as const;

export function normalizeForHash(s: string): string;
export function contentHash(s: string): string;                    // "sha256:<hex>"
export function jaccard(a: string, b: string): number;             // token-set, on normalizeForHash output
export const SIMILAR_THRESHOLD = 0.85;

/** Streamed assembly — writes header, then memory chunks, then footer. */
export async function buildArchive(args: {
  userId: string; scope: "all" | "ids"; ids?: string[];
  filters: unknown; include: { candidates: boolean; personaFiles: boolean; derived: boolean };
  onProgress: (p: { phase: string; total: number; processed: number; bytes: number }) => void;
  write: (chunk: string) => void;
}): Promise<{ counts: TwinMemoryArchive["counts"]; digest: string }>;

export function parseArchive(buf: Buffer): { archive: TwinMemoryArchive; warnings: string[] };  // throws ArchiveError
export function diffAgainstLive(archive: TwinMemoryArchive, live: Memory[]):
  { buckets: TwinImportBuckets; verdicts: Map<string, "new"|"duplicate"|"similar"|"derived">; similar: TwinSimilarRow[] };
/** Server-authored tag array — the security boundary. */
export function importTagsFor(args: { userId: string; subsystem: string; archiveId: string; pipelineEventId: string | null }): string[];
```

The **join** that recovers event timestamps, inside `buildArchive`:
1. `memory.listMemories(TWIN_BANK_ID, { tags: ["user:<id>"], limit: TWIN_MEMORIES_WIDE_FETCH })`, then **re-filter in JS** on `tags.includes("user:<id>")` — the same authoritative gate as `routes/memory.ts:615-632`. Never skip this; the provider over-matches tag queries (incident 2026-05-25).
2. Collect `pipeline:<eventId>` values → one `prisma.userMemoryCandidate.findMany({ where: { userId, pipelineEventId: { in: […] } } })`.
3. Match candidate → memory first by `pipelineEventId`, and where an event produced several candidates, disambiguate by `contentHash(candidate.editedText ?? candidate.text) === contentHash(cleanMemoryText(memory.content))`.
4. Event time = `pickEventTimestamp(candidate.sourceRefs)` (already exported from `services/userMemoryCuratorClient.ts:84`). Unjoined memories fall back to `memory.createdAt` and increment `counts.unjoined`.

**`apps/xyne-claw-auth/backend/src/queue/twin-archive-queue.ts`** — two thin `makeJobQueue` wrappers, exactly like `queue/eval-import-queue.ts`:
```ts
const exportQ = makeJobQueue<TwinExportJobData, TwinExportProgress>("twin-export", { attempts: 1 });
const importQ = makeJobQueue<TwinImportJobData, TwinImportProgress>("twin-import", { attempts: 2 });
```
`attempts: 1` for export (a retry just re-does work the user can re-trigger); `attempts: 2` for import so a pod restart resumes from `progress.cursor`. Both need `jobId` pinning, which `makeJobQueue.enqueue` does not currently expose — add an optional second arg `enqueue(data, opts?: { jobId?: string })` to `queue/job-queue.ts` and pass it through to `getQueue().add()`. That is a two-line change and it is what gives the per-user single-flight guarantee.

**`apps/xyne-claw-auth/backend/src/queue/twin-export-worker.ts`** — `initTwinExportWorker()` / `closeTwinExportWorker()`, same shape as `initEvalImportWorker`. Streams chunks into an array, gzips with `zlib.gzipSync`, writes `redisService.getConnection().set("twin:archive:<jobId>", gz, "EX", 3600)` (use `ioredis` Buffer mode). Aborts with `ARCHIVE_TOO_LARGE` past 64 MB gz.

**`apps/xyne-claw-auth/backend/src/queue/twin-import-worker.ts`** — handles both `mode: "analyze"` and `mode: "commit"` on one queue (the modal polls one status route either way). Commit loop:
```ts
for (let i = job.progress?.cursor ?? 0; i < plan.length; i += 25) {
  if (await isCancelRequested(job.id)) { … break; }
  const batch = plan.slice(i, i + 25);
  await memory.retain(TWIN_BANK_ID, batch.map((r) => ({
    content: r.content.canonical,
    tags: importTagsFor({ userId, subsystem: r.subsystem, archiveId, pipelineEventId: r.keptPipelineId }),
    ...(r.time.occurredAt ? { timestamp: r.time.occurredAt } : {}),
    observationScopes: twinObservationScopes(userId),      // NEVER from the file
  })));
  await prisma.userMemoryCandidate.createMany({ data: batch.map(toCandidateRow) });
  await job.updateProgress({ …, cursor: i + 25, imported, failed, errors });
}
```
Note the batching: the existing approve paths (`digital-twin.ts:1013`, `:1094`) retain **one item per call in a serial loop**. Copying that here makes a 5k import take ~80 minutes. Batch at 25 with concurrency 3.

## Backend edits

**`apps/xyne-claw-auth/backend/src/routes/digital-twin.ts`** — new section `// ── 11. Archive: export / import ──` after the `/upload-md` handler (`:1441`). Nine handlers, each ~20 lines, all `requireUserAuth` (already applied at the mount, `main.ts:304`) and all re-checking `job.data.userId === getUserId(req)` before returning. The multipart handler:
```ts
import multer from "multer";
const archiveUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 64 * 1024 * 1024, files: 1 } });
digitalTwinRouter.post("/memories/import/stage", requireUserAuth, archiveUpload.single("archive"), async (req, res) => { … });
```
(`routes/agents.ts:2671` and `routes/agent-chat.ts:565` are the in-repo precedents for `multer.memoryStorage()`.)

**`apps/xyne-claw-auth/backend/src/main.ts`** — import + call `initTwinExportWorker()` / `initTwinImportWorker()` next to `initEvalImportWorker()` (`:356`), and their `close*` in the shutdown block.

**`apps/xyne-claw-auth/backend/src/queue/job-queue.ts`** — add optional `jobId` to `enqueue`, as above.

## Recommended (not required) shared-package change

**`packages/xyne-claw-shared/src/memory/providers/hindsight.ts:663-679` + `types.ts:101-108`** — `mapMemory` currently discards `occurred_start`, `occurred_end`, `entities`, and `proof_count`, which Hindsight demonstrably returns (its own comment at `:665-666` lists them). Add them as optional fields on `Memory`:
```ts
export interface Memory {
  id: string; content: string; tags?: string[]; metadata?: Record<string,string>;
  factType?: string; createdAt?: string;
  occurredStart?: string; occurredEnd?: string;      // ← additive
  entities?: string[]; proofCount?: number;          // ← additive
}
```
Purely additive, zero existing readers affected. Without it, export can only recover the event timestamp for memories that still have a `UserMemoryCandidate` row — auto-approved memories (`userMemoryCuratorClient.ts:441`), agent-authored ones (`memory-write.ts:92`), and anything whose candidate row was wiped by a prior bulk delete all export with `time.occurredAt: null` and re-import at roughly now(), flattening the temporal ordering. With it, `occurred_start` is the fallback and the join becomes an enrichment rather than a load-bearing dependency.

## Test seams

- `twinMemoryArchive.test.ts`: `normalizeForHash` idempotence under Hindsight's `| Involving:` tail; `contentHash` stability across an export→import→export cycle; `jaccard("reports to anita on the platform team", "reports to marcus on the platform team")` must land **below** 0.85 (this is the regression that matters — at the recall-path's 0.6 it collides).
- `importTagsFor` must drop `shared`, any `user:` other than the requester, and any unknown `subsystem:`; assert on a hand-forged archive.
- `digital-twin.archive.test.ts` (route level, following `admin-digital-twin.test.ts`): stage a foreign-user archive → `summary.sameUser === false`, and after commit assert every retained item's tags carry `user:<requester>` and no `pipeline:` tag.


## Risks

1. Retain is re-extractive, so round-trip is not byte-faithful: `HindsightProvider.retain` posts `async: true` and Hindsight re-runs LLM fact extraction on the content. One archived record can become several memories or merge into an existing one. The import result count is 'records submitted', not 'memories created' — the UI must say so, and any test asserting live-count == imported-count will flake.

2. Imported memories do not appear immediately. `async: true` means extraction completes minutes later. Without the explicit 'still extracting' copy and the delayed refresh, users will conclude the import failed and run it again — producing exactly the duplication the feature exists to avoid.

3. Content-hash duplicate detection is defeated by any Hindsight rewording. Hindsight stores its own extracted phrasing plus a `| Involving: … | When: …` tail; if a future Hindsight version paraphrases more aggressively, an exact re-import of an unchanged archive will read as 'new' and duplicate everything. The 0.85 Jaccard tier is the backstop, and it is a heuristic.

4. The 0.85 similarity threshold is a judgment call with no measured data behind it. Set it too low and a genuinely changed fact ('manager is Marcus') gets silently skipped as a near-duplicate of the stale one — the precise destructive-update failure the append-only design at `routes/memory.ts:412-418` was written to prevent. Defaulting similar rows to Skip means a restore can quietly drop changed facts unless the user opens the disclosure. Consider defaulting similar to Import instead, once there is real data.

5. Tag injection is a genuine privilege-escalation vector, not a theoretical one: `routes/memory.ts:660-679` derives a memory's *scope* from its tags, so a crafted archive carrying `shared` or `user:<victim>` would place records outside the importing user's boundary. The whole design depends on the importer discarding `tagsAsStored` unconditionally. A future 'preserve original tags' convenience option would reopen this.

6. Replace mode can destroy data if the safety export is bypassed. The gate is client-side (button disabled until the download fires); a direct `POST /commit` with `policy: "replace", confirmException: "REPLACE"` skips it entirely. Accept this (the API is cookie-authenticated and per-user), or add a server-side requirement that a completed export job exists for the user within the last hour.

7. Redis-staged artifacts are a memory-pressure risk. A 64 MB gzipped export plus a 64 MB staged import per concurrent user, held 1 h / 24 h, is real Redis footprint on a shared instance. If several heavy users import at once this competes with the BullMQ queues themselves. Object storage would be the right home; there is none evident in this app.

8. Event timestamps are only fully recoverable via the Postgres join, and that join is lossy. Memories whose `UserMemoryCandidate` rows were deleted by a prior bulk delete (`digital-twin.ts:707`, which wipes candidates alongside memories) have no `sourceRefs` and no `pipelineEventId`, so they export with `occurredAt: null` and re-import stamped at retain time — flattening the chronological ordering the backfill worker deliberately built. The `mapMemory` change mitigates this but is not required, so the first version will ship with the gap.

9. Derived observations are excluded by default on the honest assumption that Hindsight regenerates them. If it does not — the repo contradicts itself on what observations are (`hindsight.ts:182` vs the three shipped UI legends) — then a Replace-mode restore permanently loses the observation layer, and the user has no way to rebuild it short of a full delete-and-backfill.

10. Export holds the user's entire memory set in one client-downloadable file. That is the point, but it turns a single stolen laptop or a mis-shared file into a complete personal-context leak with no revocation. There is no encryption, no expiry, and no audit trail of who exported what. At minimum, log an `[digital-twin] archive exported` line with userId + record count, and consider surfacing exports in the user's own activity view.
