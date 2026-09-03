import { describe, expect, it } from "vitest";
import { markCoverage, renderPriorRuns, type PriorRun } from "./prior-runs.js";
import type { WindowEvent } from "./types.js";

const T = 1_700_000_000_000;

const prior = (over: Partial<PriorRun> = {}): PriorRun => ({
  kind: "reflex",
  windowStartMs: T,
  windowEndMs: T + 300_000,
  outcome: "ran",
  eventCount: 3,
  sessionId: "s1",
  startedAt: new Date(T + 10_000),
  completedAt: new Date(T + 290_000),
  result: "acked the spike",
  status: "completed",
  covers: true,
  ...over,
});

const ev = (atMs: number, over: Partial<WindowEvent> = {}): WindowEvent => ({
  L: 0, kind: "message", at: new Date(atMs).toISOString(), atMs, id: `m${atMs}`,
  ch: "ch_1", chName: "eng", cv: "cv_1", cvTitle: "t", sender: "Ann", senderId: "u_1",
  isHuman: true, isMe: false, root: false, mentionsMe: false, unanswered: false,
  covered: false, coveredBy: null, question: false, actionSignals: [], edited: false,
  chars: 0, text: "", ...over,
});

describe("markCoverage", () => {
  it("marks events inside a covering run's window", () => {
    const events = [ev(T + 100_000), ev(T + 200_000)];
    markCoverage(events, [prior()]);
    expect(events.every((e) => e.covered)).toBe(true);
    expect(events[0]!.coveredBy).toContain("reflex@");
  });

  it("leaves events AFTER the prior run uncovered", () => {
    const events = [ev(T + 100_000), ev(T + 400_000)];
    markCoverage(events, [prior()]);
    expect(events[0]!.covered).toBe(true);
    expect(events[1]!.covered).toBe(false);
    expect(events[1]!.coveredBy).toBeNull();
  });

  it("leaves events BEFORE the prior run uncovered", () => {
    const events = [ev(T - 60_000)];
    markCoverage(events, [prior()]);
    expect(events[0]!.covered).toBe(false);
  });

  it("treats the window as half-open — the exact start instant is not covered", () => {
    const events = [ev(T), ev(T + 1)];
    markCoverage(events, [prior()]);
    expect(events[0]!.covered).toBe(false);
    expect(events[1]!.covered).toBe(true);
  });

  /**
   * The rule that is easiest to get backwards: a run that did not act covers
   * nothing. Marking its events handled is how work silently disappears.
   */
  it("a FAILED prior run covers nothing", () => {
    const events = [ev(T + 100_000)];
    markCoverage(events, [prior({ covers: false, outcome: "failed", status: "failed" })]);
    expect(events[0]!.covered).toBe(false);
  });

  it("a SHADOW run covers nothing — nobody saw its output", () => {
    const events = [ev(T + 100_000)];
    markCoverage(events, [prior({ covers: false, outcome: "shadow" })]);
    expect(events[0]!.covered).toBe(false);
  });

  it("a SKIPPED run covers nothing", () => {
    const events = [ev(T + 100_000)];
    markCoverage(events, [prior({ covers: false, outcome: "skipped" })]);
    expect(events[0]!.covered).toBe(false);
  });

  it("an in-flight run DOES cover, so the heartbeat does not race it", () => {
    const events = [ev(T + 100_000)];
    markCoverage(events, [prior({ completedAt: null, status: "running", covers: true })]);
    expect(events[0]!.covered).toBe(true);
  });

  it("with several priors, the first covering one wins", () => {
    const events = [ev(T + 100_000)];
    markCoverage(events, [
      prior({ covers: false, outcome: "failed" }),
      prior({ kind: "reflex", startedAt: new Date(T + 20_000) }),
    ]);
    expect(events[0]!.covered).toBe(true);
  });

  it("no priors leaves everything uncovered", () => {
    const events = [ev(T + 100_000)];
    markCoverage(events, []);
    expect(events[0]!.covered).toBe(false);
  });

  it("re-marking is idempotent — a re-render cannot flip a verdict", () => {
    const events = [ev(T + 400_000, { covered: true, coveredBy: "stale" })];
    markCoverage(events, [prior()]);
    expect(events[0]!.covered).toBe(false);
    expect(events[0]!.coveredBy).toBeNull();
  });
});

describe("renderPriorRuns", () => {
  it("says plainly when nothing ran before", () => {
    expect(renderPriorRuns([])).toContain("Everything in this window is new to you");
  });

  it("includes what a covering run actually said", () => {
    expect(renderPriorRuns([prior()])).toContain("acked the spike");
  });

  it("flags a failed run as unhandled", () => {
    const md = renderPriorRuns([prior({ covers: false, outcome: "failed" })]);
    expect(md).toContain("Treat its events as unhandled");
  });

  it("explains that a shadow run posted nothing", () => {
    const md = renderPriorRuns([prior({ covers: false, outcome: "shadow" })]);
    expect(md).toContain("posted nothing");
  });

  it("marks an in-flight run and tells the agent to keep clear", () => {
    const md = renderPriorRuns([prior({ completedAt: null, result: null })]);
    expect(md).toContain("IN FLIGHT");
    expect(md).toContain("Leave the threads it is working on alone");
  });

  it("truncates a very long prior result rather than flooding the artifact", () => {
    const md = renderPriorRuns([prior({ result: "x".repeat(10_000) })]);
    expect(md.length).toBeLessThan(6_000);
  });
});
