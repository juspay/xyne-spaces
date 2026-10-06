/**
 * Digital Twin backfill state: the JSONB types, the window validation + state
 * builders shared by the user route, the admin controls and the worker, and the
 * pure STATUS + PAUSE/RESUME math.
 *
 * No IO here — every function takes plain state in and returns plain data out,
 * so the tricky bits (paused vs running vs stalled, what a resume re-enqueues)
 * are unit-testable without Redis/Prisma. `digital-twin.ts` wires these to the
 * queue + the User.digitalTwinBackfillState JSONB column.
 *
 * The backfill state shape (persisted by digital-twin-backfill-worker.ts):
 *   { [source]: { from, to, cursor, complete, pausedAt?, progress? } }
 */

/** Sources the backfill walks (one BullMQ job per source per user). */
export const BACKFILL_SOURCES = ["messages", "calls", "canvases"] as const;
export type BackfillSource = (typeof BACKFILL_SOURCES)[number];

/** Strict shape of what the builders/worker write (every field present). */
export interface BackfillProgress {
  /** ceil((to-from)/BACKFILL_WINDOW_MS). */
  windowsTotal: number;
  windowsDone: number;
  /** Running sum of records fetched across processed windows. */
  recordsSeen: number;
  /** Running sum of candidates persisted across processed windows. */
  candidatesMade: number;
  currentWindow: { from: string; to: string } | null;
  lastError: { message: string; windowUpper: string; at: string } | null;
  startedAt: string;
  /** Set on EVERY write — the server heartbeat the status endpoint watches. */
  updatedAt: string;
}

export interface BackfillEntry {
  from: string;
  to: string;
  cursor: string;
  complete: boolean;
  /** ISO timestamp set when the user PAUSED this (incomplete) source. Absent =
   *  not paused. The cursor is preserved so a resume continues where it left;
   *  a paused source is NOT auto-recovered on startup (the user deliberately
   *  stopped it). */
  pausedAt?: string;
  progress?: BackfillProgress;
}

export type StrictBackfillState = Record<string, BackfillEntry>;

/** Tolerant shapes for state read back from the JSONB column (any field may be
 *  missing on old/partial rows). */
export type BackfillProgressShape = Partial<BackfillProgress>;
export type BackfillEntryShape = Partial<Omit<BackfillEntry, "progress">> & {
  progress?: BackfillProgressShape;
};

export interface BackfillJobProbe {
  state: string;
  attemptsMade: number;
  maxAttempts: number;
  failedReason: string | null;
}

export type BackfillState = Record<string, BackfillEntryShape>;

/** The raw JSONB column as a state object, or null when it is absent/not an
 *  object. Arrays pass through, exactly like the inline checks this replaced. */
export function asBackfillState(raw: unknown): BackfillState | null {
  return raw && typeof raw === "object" ? (raw as BackfillState) : null;
}

/** Hard limit on the backfill window length, in calendar months. */
export const MAX_BACKFILL_MONTHS = 24;

/** One window = one month. Each window fans out into token-budgeted curator
 *  batches (userMemoryBatcher). 24-month backfill → up to 24 windows × 3 sources. */
export const BACKFILL_WINDOW_MS = 30 * 24 * 3600 * 1000;

/**
 * Why a requested backfill window is unacceptable, or null when it is fine.
 * Unparsable dates / from after to → 'invalid' (checked first), a span over
 * MAX_BACKFILL_MONTHS → 'too-long'. The caller owns the error message/status.
 */
export function backfillRangeProblem(from: Date, to: Date): "invalid" | "too-long" | null {
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) return "invalid";
  // Calendar months, NOT 30-day months. A true 24-calendar-month span is
  // 730/731 days = 24.33 "30-day months", so 30-day arithmetic rejected the
  // UI's own "Last 24 months" preset with a 400 every single time.
  const earliestAllowed = new Date(to);
  earliestAllowed.setUTCMonth(earliestAllowed.getUTCMonth() - MAX_BACKFILL_MONTHS);
  return from < earliestAllowed ? "too-long" : null;
}

/** Total windows the walk covers, ceil'd. Never < 1 so an all-in-one-window
 *  range still reports 1/1 at completion. */
export function windowsTotalFor(fromIso: string, toIso: string): number {
  const span = new Date(toIso).getTime() - new Date(fromIso).getTime();
  if (!Number.isFinite(span) || span <= 0) return 1;
  return Math.max(1, Math.ceil(span / BACKFILL_WINDOW_MS));
}

export function seedBackfillProgress(fromIso: string, toIso: string, nowIso: string): BackfillProgress {
  return {
    windowsTotal: windowsTotalFor(fromIso, toIso),
    windowsDone: 0,
    recordsSeen: 0,
    candidatesMade: 0,
    currentWindow: null,
    lastError: null,
    startedAt: nowIso,
    updatedAt: nowIso,
  };
}

/** Fresh state for a (re-)enable / admin start: one entry per source, all
 *  walking the same window. Fresh progress every time so old counts never
 *  carry over. */
export function buildBackfillState({ from, to }: { from: Date; to: Date }, now: Date): StrictBackfillState {
  const fromIso = from.toISOString();
  const toIso = to.toISOString();
  const nowIso = now.toISOString();
  const state: StrictBackfillState = {};
  for (const source of BACKFILL_SOURCES) {
    state[source] = {
      from: fromIso,
      to: toIso,
      // Chronological walk (oldest → newest): cursor is the LOWER bound of the
      // next chunk, seeded at `from`. See the backfill worker.
      cursor: fromIso,
      complete: false,
      progress: seedBackfillProgress(fromIso, toIso, nowIso),
    };
  }
  return state;
}

/** Legacy cursor math: fraction of the [from,to] span already walked. */
export function pctByTime(entry: BackfillEntryShape): number | null {
  if (!entry.from || !entry.to || !entry.cursor) return null;
  const from = new Date(entry.from).getTime();
  const to = new Date(entry.to).getTime();
  const cursor = new Date(entry.cursor).getTime();
  const span = to - from;
  if (!Number.isFinite(span) || span <= 0) return null;
  const done = to - cursor;
  return Math.max(0, Math.min(100, Math.round((done / span) * 100)));
}

export function pctByWindows(p: BackfillProgressShape | undefined): number | null {
  if (!p || typeof p.windowsTotal !== "number" || p.windowsTotal <= 0) return null;
  return Math.round((100 * (p.windowsDone ?? 0)) / p.windowsTotal);
}

/** A source is "paused" when it's incomplete AND carries a pausedAt stamp. */
export function isSourcePaused(entry: BackfillEntryShape | undefined): boolean {
  return !!entry && entry.complete !== true && !!entry.pausedAt;
}

/**
 * PAUSE: stamp `pausedAt` on every INCOMPLETE source (complete sources are done
 * and have no job to stop). Cursor/progress are left untouched so a later resume
 * continues exactly where the walk stopped. Mutates `state` in place and returns
 * how many sources were paused. Idempotent — re-pausing refreshes the stamp.
 */
export function applyBackfillPause(state: BackfillState, nowIso: string): number {
  let paused = 0;
  for (const s of BACKFILL_SOURCES) {
    const entry = state[s];
    if (entry && entry.complete !== true) {
      entry.pausedAt = nowIso;
      paused += 1;
    }
  }
  return paused;
}

/**
 * RESUME: the incomplete sources a resume should re-enqueue. Clears `pausedAt`
 * on each (mutates `state`) and returns the source keys to re-enqueue (from
 * their persisted cursor). Complete sources are skipped. Entries with an invalid
 * from/to are skipped (can't build a valid job window).
 */
export function collectAndClearResumable(state: BackfillState): BackfillSource[] {
  const out: BackfillSource[] = [];
  for (const s of BACKFILL_SOURCES) {
    const entry = state[s];
    if (!entry || entry.complete === true) continue;
    if (!entry.from || !entry.to) continue;
    if (Number.isNaN(new Date(entry.from).getTime()) || Number.isNaN(new Date(entry.to).getTime())) continue;
    delete entry.pausedAt;
    out.push(s);
  }
  return out;
}

/** Incomplete + NOT paused source keys — what the startup self-heal re-enqueues
 *  (only when the queue has no live job for them). Pure; does not mutate. */
export function recoverableSources(state: BackfillState): BackfillSource[] {
  return BACKFILL_SOURCES.filter((s) => {
    const entry = state[s];
    return !!entry && entry.complete !== true && !entry.pausedAt && !!entry.from && !!entry.to;
  });
}

export interface BackfillSummary {
  overall: {
    running: boolean;
    paused: boolean;
    stalled: boolean;
    windowsDone: number;
    windowsTotal: number;
    recordsSeen: number;
    candidatesMade: number;
    pctByWindows: number | null;
    updatedAt: string | null;
  };
  sources: Record<string, unknown>;
}

/**
 * Pure status summary of a backfill state. `probes` maps source → BullMQ probe
 * (or null). `nowMs`/`stallMs` are injected so the stalled math is testable.
 *
 * Semantics:
 *  - running  = at least one source is incomplete AND not paused.
 *  - paused   = at least one incomplete source is paused (and none is running).
 *               A PAUSED backfill is never reported as running or stalled — that
 *               is the whole point: the UI shows "Paused", not "Backfilling 83%".
 *  - stalled  = running, not paused, and no heartbeat within stallMs.
 * Returns null when there are no known sources in the state.
 */
export function summarizeBackfillState(
  state: BackfillState,
  probes: Partial<Record<BackfillSource, BackfillJobProbe | null>>,
  opts: { nowMs: number; stallMs: number },
): BackfillSummary | null {
  const sourceKeys = BACKFILL_SOURCES.filter((s) => state[s]);
  if (sourceKeys.length === 0) return null;

  const sources: Record<string, unknown> = {};
  let running = false;
  let anyPaused = false;
  let windowsDoneTotal = 0;
  let windowsTotalTotal = 0;
  let recordsSeenTotal = 0;
  let candidatesMadeTotal = 0;
  let maxUpdatedAt: string | null = null;

  for (const s of sourceKeys) {
    const entry = state[s]!;
    const p = entry.progress;
    const complete = entry.complete === true;
    const paused = isSourcePaused(entry);
    if (paused) anyPaused = true;
    if (!complete && !paused) running = true;

    const wDone = p && typeof p.windowsDone === "number" ? p.windowsDone : null;
    const wTotal = p && typeof p.windowsTotal === "number" ? p.windowsTotal : null;
    if (wDone !== null) windowsDoneTotal += wDone;
    if (wTotal !== null) windowsTotalTotal += wTotal;
    if (p && typeof p.recordsSeen === "number") recordsSeenTotal += p.recordsSeen;
    if (p && typeof p.candidatesMade === "number") candidatesMadeTotal += p.candidatesMade;
    if (p?.updatedAt && (!maxUpdatedAt || p.updatedAt > maxUpdatedAt)) maxUpdatedAt = p.updatedAt;

    sources[s] = {
      complete,
      paused,
      pausedAt: entry.pausedAt ?? null,
      windowsDone: wDone,
      windowsTotal: wTotal,
      recordsSeen: p && typeof p.recordsSeen === "number" ? p.recordsSeen : null,
      candidatesMade: p && typeof p.candidatesMade === "number" ? p.candidatesMade : null,
      currentWindow: p?.currentWindow ?? null,
      pctByWindows: pctByWindows(p),
      pctByTime: pctByTime(entry),
      lastError: p?.lastError ?? null,
      job: probes[s] ?? null,
    };
  }

  const stalled =
    running &&
    !anyPaused &&
    !!maxUpdatedAt &&
    opts.nowMs - new Date(maxUpdatedAt).getTime() > opts.stallMs;

  return {
    overall: {
      running,
      paused: anyPaused && !running,
      stalled,
      windowsDone: windowsDoneTotal,
      windowsTotal: windowsTotalTotal,
      recordsSeen: recordsSeenTotal,
      candidatesMade: candidatesMadeTotal,
      pctByWindows: windowsTotalTotal > 0 ? Math.round((100 * windowsDoneTotal) / windowsTotalTotal) : null,
      updatedAt: maxUpdatedAt,
    },
    sources,
  };
}
