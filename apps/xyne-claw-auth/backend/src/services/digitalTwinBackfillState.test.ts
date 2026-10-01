import { describe, it, expect } from "vitest";
import {
  applyBackfillPause,
  asBackfillState,
  backfillRangeProblem,
  buildBackfillState,
  collectAndClearResumable,
  recoverableSources,
  summarizeBackfillState,
  isSourcePaused,
  pctByTime,
  pctByWindows,
  windowsTotalFor,
  type BackfillState,
} from "./digitalTwinBackfillState.js";

const ISO = (s: string) => new Date(s).toISOString();

/** Mirrors the real shape the worker persists (from the user's stuck status):
 *  calls + canvases complete, messages incomplete at window 3/7. */
function stuckState(): BackfillState {
  return {
    calls: {
      from: ISO("2026-01-18"),
      to: ISO("2026-07-18"),
      cursor: ISO("2026-07-18"),
      complete: true,
      progress: { windowsTotal: 7, windowsDone: 7, recordsSeen: 0, candidatesMade: 0, currentWindow: null, lastError: null, updatedAt: ISO("2026-07-18T13:34:12Z") },
    },
    canvases: {
      from: ISO("2026-01-18"),
      to: ISO("2026-07-18"),
      cursor: ISO("2026-07-18"),
      complete: true,
      progress: { windowsTotal: 7, windowsDone: 7, recordsSeen: 54, candidatesMade: 64, currentWindow: null, lastError: null, updatedAt: ISO("2026-07-18T13:58:42Z") },
    },
    messages: {
      from: ISO("2026-01-18"),
      to: ISO("2026-07-18"),
      cursor: ISO("2026-04-18"),
      complete: false,
      progress: { windowsTotal: 7, windowsDone: 3, recordsSeen: 242, candidatesMade: 111, currentWindow: { from: ISO("2026-04-18"), to: ISO("2026-05-18") }, lastError: null, updatedAt: ISO("2026-07-18T14:33:14Z") },
    },
  };
}

describe("applyBackfillPause", () => {
  it("stamps pausedAt on ONLY incomplete sources and returns the count", () => {
    const state = stuckState();
    const now = ISO("2026-07-20T00:00:00Z");
    const count = applyBackfillPause(state, now);
    expect(count).toBe(1); // only messages is incomplete
    expect(state.messages!.pausedAt).toBe(now);
    expect(state.calls!.pausedAt).toBeUndefined();
    expect(state.canvases!.pausedAt).toBeUndefined();
  });

  it("returns 0 when everything is already complete (no-op pause)", () => {
    const state = stuckState();
    state.messages!.complete = true;
    expect(applyBackfillPause(state, ISO("2026-07-20"))).toBe(0);
    expect(state.messages!.pausedAt).toBeUndefined();
  });
});

describe("collectAndClearResumable", () => {
  it("returns incomplete sources, clears their pausedAt, and skips complete ones", () => {
    const state = stuckState();
    applyBackfillPause(state, ISO("2026-07-20"));
    expect(state.messages!.pausedAt).toBeDefined();
    const resumable = collectAndClearResumable(state);
    expect(resumable).toEqual(["messages"]);
    expect(state.messages!.pausedAt).toBeUndefined(); // cleared
    expect(state.calls!.complete).toBe(true); // untouched
  });

  it("skips sources with an invalid/missing window", () => {
    const state: BackfillState = {
      messages: { from: "not-a-date", to: ISO("2026-07-18"), cursor: ISO("2026-04-18"), complete: false },
      calls: { to: ISO("2026-07-18"), cursor: ISO("2026-07-18"), complete: false }, // no `from`
    };
    expect(collectAndClearResumable(state)).toEqual([]);
  });
});

describe("recoverableSources", () => {
  it("returns incomplete + NOT paused sources (the startup self-heal set)", () => {
    const state = stuckState();
    expect(recoverableSources(state)).toEqual(["messages"]);
  });

  it("excludes a paused source (deliberate stop — do not auto-recover)", () => {
    const state = stuckState();
    applyBackfillPause(state, ISO("2026-07-20"));
    expect(recoverableSources(state)).toEqual([]);
  });
});

describe("isSourcePaused", () => {
  it("is true only for incomplete + pausedAt", () => {
    expect(isSourcePaused({ complete: false, pausedAt: ISO("2026-07-20") })).toBe(true);
    expect(isSourcePaused({ complete: false })).toBe(false);
    expect(isSourcePaused({ complete: true, pausedAt: ISO("2026-07-20") })).toBe(false); // complete wins
    expect(isSourcePaused(undefined)).toBe(false);
  });
});

describe("summarizeBackfillState", () => {
  const NOW = new Date("2026-07-20T00:00:00Z").getTime();
  const STALL = 120_000;

  it("returns null for empty/absent state", () => {
    expect(summarizeBackfillState({}, {}, { nowMs: NOW, stallMs: STALL })).toBeNull();
  });

  it("reports running=true + stalled=true for the wedged (no heartbeat for days) case", () => {
    const out = summarizeBackfillState(stuckState(), {}, { nowMs: NOW, stallMs: STALL })!;
    expect(out.overall.running).toBe(true);
    expect(out.overall.paused).toBe(false);
    expect(out.overall.stalled).toBe(true); // updatedAt is 2 days old
    expect(out.overall.windowsDone).toBe(17); // 7+7+3
    expect(out.overall.windowsTotal).toBe(21);
    expect(out.overall.pctByWindows).toBe(81);
  });

  it("PAUSED backfill is never running nor stalled (UI shows Paused, not 83%)", () => {
    const state = stuckState();
    applyBackfillPause(state, ISO("2026-07-19T00:00:00Z")); // paused, still old heartbeat
    const out = summarizeBackfillState(state, {}, { nowMs: NOW, stallMs: STALL })!;
    expect(out.overall.running).toBe(false);
    expect(out.overall.paused).toBe(true);
    expect(out.overall.stalled).toBe(false); // the key fix: no phantom "stalled"
    expect((out.sources.messages as { paused: boolean }).paused).toBe(true);
    expect((out.sources.messages as { pausedAt: string | null }).pausedAt).toBe(ISO("2026-07-19T00:00:00Z"));
  });

  it("all-complete state is not running/paused/stalled", () => {
    const state = stuckState();
    state.messages!.complete = true;
    const out = summarizeBackfillState(state, {}, { nowMs: NOW, stallMs: STALL })!;
    expect(out.overall.running).toBe(false);
    expect(out.overall.paused).toBe(false);
    expect(out.overall.stalled).toBe(false);
  });

  it("running but FRESH heartbeat is not stalled", () => {
    const state = stuckState();
    state.messages!.progress!.updatedAt = new Date(NOW - 5_000).toISOString(); // 5s ago
    const out = summarizeBackfillState(state, {}, { nowMs: NOW, stallMs: STALL })!;
    expect(out.overall.running).toBe(true);
    expect(out.overall.stalled).toBe(false);
  });

  it("passes the BullMQ job probe through per source", () => {
    const probe = { state: "failed", attemptsMade: 1, maxAttempts: 5, failedReason: "job stalled more than allowable limit" };
    const out = summarizeBackfillState(stuckState(), { messages: probe }, { nowMs: NOW, stallMs: STALL })!;
    expect((out.sources.messages as { job: unknown }).job).toEqual(probe);
    expect((out.sources.calls as { job: unknown }).job).toBeNull();
  });
});

describe("pct helpers", () => {
  it("pctByWindows = windowsDone / windowsTotal", () => {
    expect(pctByWindows({ windowsTotal: 7, windowsDone: 3 })).toBe(43);
    expect(pctByWindows({ windowsTotal: 0, windowsDone: 0 })).toBeNull();
    expect(pctByWindows(undefined)).toBeNull();
  });

  it("pctByTime = fraction of [from,to] span walked past the cursor", () => {
    // cursor at 2026-04-18 of a 2026-01-18..2026-07-18 span → ~50%
    expect(pctByTime({ from: ISO("2026-01-18"), to: ISO("2026-07-18"), cursor: ISO("2026-04-18") })).toBe(50);
    expect(pctByTime({ from: ISO("2026-01-18"), to: ISO("2026-07-18"), cursor: ISO("2026-07-18") })).toBe(0);
    expect(pctByTime({ from: ISO("2026-01-18"), to: ISO("2026-07-18"), cursor: ISO("2026-01-18") })).toBe(100);
  });
});

describe("buildBackfillState", () => {
  it("seeds every source with the same window, a cursor at `from` and fresh progress", () => {
    const now = new Date("2026-08-15T10:00:00.000Z");
    const nowIso = now.toISOString();
    const state = buildBackfillState(
      { from: new Date("2026-05-15T10:00:00.000Z"), to: new Date("2026-08-15T10:00:00.000Z") },
      now,
    );
    const entry = {
      from: "2026-05-15T10:00:00.000Z",
      to: "2026-08-15T10:00:00.000Z",
      cursor: "2026-05-15T10:00:00.000Z",
      complete: false,
      progress: {
        windowsTotal: 4, // 92 days / 30d, ceil'd
        windowsDone: 0,
        recordsSeen: 0,
        candidatesMade: 0,
        currentWindow: null,
        lastError: null,
        startedAt: nowIso,
        updatedAt: nowIso,
      },
    };
    expect(state).toEqual({ messages: entry, calls: entry, canvases: entry });
    expect(Object.keys(state)).toEqual(["messages", "calls", "canvases"]);
  });
});

describe("backfillRangeProblem", () => {
  it("flags unparsable dates and from > to as 'invalid'", () => {
    const ok = new Date("2026-08-15T00:00:00.000Z");
    expect(backfillRangeProblem(new Date("nope"), ok)).toBe("invalid");
    expect(backfillRangeProblem(ok, new Date("nope"))).toBe("invalid");
    expect(backfillRangeProblem(new Date("2026-08-16T00:00:00.000Z"), ok)).toBe("invalid");
  });

  it("accepts exactly 24 calendar months and rejects anything longer", () => {
    const to = new Date("2026-08-15T00:00:00.000Z");
    expect(backfillRangeProblem(new Date("2024-08-15T00:00:00.000Z"), to)).toBeNull();
    expect(backfillRangeProblem(new Date("2024-08-14T23:59:59.999Z"), to)).toBe("too-long");
  });
});

describe("windowsTotalFor", () => {
  it("is ceil(span / 30d) and never below 1", () => {
    expect(windowsTotalFor("2026-08-15T00:00:00.000Z", "2026-08-15T00:00:00.000Z")).toBe(1);
    expect(windowsTotalFor("not-a-date", "2026-08-15T00:00:00.000Z")).toBe(1);
    expect(windowsTotalFor("2024-08-15T00:00:00.000Z", "2026-08-15T00:00:00.000Z")).toBe(25);
  });
});

describe("asBackfillState", () => {
  it("passes objects (arrays included) through and nulls everything else", () => {
    const state = { messages: { complete: false } };
    expect(asBackfillState(state)).toBe(state);
    expect(asBackfillState([])).toEqual([]);
    expect(asBackfillState(null)).toBeNull();
    expect(asBackfillState(undefined)).toBeNull();
    expect(asBackfillState("x")).toBeNull();
    expect(asBackfillState(0)).toBeNull();
  });
});
