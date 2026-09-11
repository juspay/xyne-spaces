import { describe, expect, it } from "vitest";
import { evaluateGate } from "./gate.js";
import { computeSignals } from "./signals.js";
import { markUnanswered } from "./collector.js";
import { AWAKENING_DEFAULTS, type AwakeningConfig } from "./config.js";
import type { WindowEvent, WindowSignals } from "./types.js";

const cfg = (over: Partial<AwakeningConfig["gate"]> = {}): AwakeningConfig => ({
  ...AWAKENING_DEFAULTS,
  gate: { ...AWAKENING_DEFAULTS.gate, ...over },
});

const sig = (over: Partial<WindowSignals> = {}): WindowSignals => ({
  ...computeSignals([]),
  eventCount: 1,
  humanEventCount: 1,
  ...over,
});

describe("evaluateGate — skip rules (the cost control)", () => {
  it("skips an empty window", () => {
    expect(evaluateGate({ signals: computeSignals([]), config: cfg(), consecutiveSkips: 0 })).toEqual({
      decision: "skip",
      rule: "empty_window",
    });
  });

  it("skips a window with no human activity — this is how an agent avoids talking to itself", () => {
    const out = evaluateGate({
      signals: sig({ eventCount: 40, humanEventCount: 0, selfEventCount: 10, botEventCount: 30 }),
      config: cfg(),
      consecutiveSkips: 0,
    });
    expect(out).toEqual({ decision: "skip", rule: "no_human_activity" });
  });

  it("skips below the configured human-event floor", () => {
    const out = evaluateGate({
      signals: sig({ eventCount: 2, humanEventCount: 2 }),
      config: cfg({ minHumanEvents: 5 }),
      consecutiveSkips: 0,
    });
    expect(out).toEqual({ decision: "skip", rule: "below_min_human_events" });
  });

  it("skips chatter with nothing actionable in it", () => {
    const out = evaluateGate({
      signals: sig({ eventCount: 30, humanEventCount: 30, unansweredThreads: 0, questions: 0 }),
      config: cfg(),
      consecutiveSkips: 0,
    });
    expect(out).toEqual({ decision: "skip", rule: "no_actionable_signal" });
  });
});

describe("evaluateGate — run rules", () => {
  it("always runs on a direct mention, even in an otherwise dead window", () => {
    const out = evaluateGate({
      signals: sig({ eventCount: 1, humanEventCount: 1, mentionsOfMe: 1 }),
      config: cfg({ minHumanEvents: 100 }),
      consecutiveSkips: 0,
    });
    expect(out).toEqual({ decision: "run", rule: "direct_mention" });
  });

  it("mention beats the no-human-activity skip (a mention by a bot still concerns the agent)", () => {
    const out = evaluateGate({
      signals: sig({ eventCount: 1, humanEventCount: 0, mentionsOfMe: 1 }),
      config: cfg(),
      consecutiveSkips: 0,
    });
    expect(out.decision).toBe("run");
  });

  it("runs on an escalation signal ahead of any volume rule", () => {
    const out = evaluateGate({
      signals: sig({ eventCount: 1, humanEventCount: 1, actionSignals: 1 }),
      config: cfg({ minHumanEvents: 50 }),
      consecutiveSkips: 0,
    });
    expect(out).toEqual({ decision: "run", rule: "escalation_signal" });
  });

  it("runs when a thread is left unanswered", () => {
    const out = evaluateGate({
      signals: sig({ eventCount: 5, humanEventCount: 5, unansweredThreads: 2 }),
      config: cfg(),
      consecutiveSkips: 0,
    });
    expect(out).toEqual({ decision: "run", rule: "unanswered_thread" });
  });

  it("runs on an open question", () => {
    const out = evaluateGate({
      signals: sig({ eventCount: 5, humanEventCount: 5, questions: 1 }),
      config: cfg(),
      consecutiveSkips: 0,
    });
    expect(out).toEqual({ decision: "run", rule: "open_question" });
  });
});

describe("evaluateGate — anti-starvation", () => {
  it("forces a run once the skip streak reaches the threshold", () => {
    const signals = sig({ eventCount: 10, humanEventCount: 0 });
    expect(evaluateGate({ signals, config: cfg({ forceRunEveryNSkips: 3 }), consecutiveSkips: 2 }).decision).toBe("skip");
    expect(evaluateGate({ signals, config: cfg({ forceRunEveryNSkips: 3 }), consecutiveSkips: 3 })).toEqual({
      decision: "run",
      rule: "forced_after_skips",
    });
  });

  it("is disabled at 0 no matter how long the streak", () => {
    const out = evaluateGate({
      signals: sig({ eventCount: 10, humanEventCount: 0 }),
      config: cfg({ forceRunEveryNSkips: 0 }),
      consecutiveSkips: 999,
    });
    expect(out.decision).toBe("skip");
  });

  it("never forces a run on a genuinely empty window — there is nothing to act on", () => {
    const out = evaluateGate({
      signals: computeSignals([]),
      config: cfg({ forceRunEveryNSkips: 1 }),
      consecutiveSkips: 50,
    });
    expect(out).toEqual({ decision: "skip", rule: "empty_window" });
  });
});

// --- signals + unanswered marking -------------------------------------------

function ev(over: Partial<WindowEvent>): WindowEvent {
  return {
    L: 0,
    kind: "message",
    at: new Date(over.atMs ?? 0).toISOString(),
    atMs: 0,
    id: "m1",
    ch: "ch_1",
    chName: "eng",
    cv: "cv_1",
    cvTitle: "t",
    sender: "Ann",
    senderId: "u_1",
    isHuman: true,
    isMe: false,
    root: false,
    mentionsMe: false,
    unanswered: false,
    covered: false,
    coveredBy: null,
    question: false,
    actionSignals: [],
    edited: false,
    chars: 0,
    text: "",
    ...over,
  };
}

describe("markUnanswered", () => {
  it("marks the last human message of a thread", () => {
    const events = [
      ev({ id: "a", atMs: 1, cv: "cv_1" }),
      ev({ id: "b", atMs: 2, cv: "cv_1" }),
    ];
    markUnanswered(events);
    expect(events[0]!.unanswered).toBe(false);
    expect(events[1]!.unanswered).toBe(true);
  });

  it("does NOT mark a thread whose last message is the agent itself", () => {
    const events = [
      ev({ id: "a", atMs: 1, cv: "cv_1" }),
      ev({ id: "b", atMs: 2, cv: "cv_1", isHuman: false, isMe: true }),
    ];
    markUnanswered(events);
    expect(events.some((e) => e.unanswered)).toBe(false);
  });

  it("does not mark a thread whose last message is another bot", () => {
    const events = [ev({ id: "a", atMs: 1, cv: "cv_1", isHuman: false })];
    markUnanswered(events);
    expect(events[0]!.unanswered).toBe(false);
  });

  it("tracks each thread independently", () => {
    const events = [
      ev({ id: "a", atMs: 1, cv: "cv_1" }),
      ev({ id: "b", atMs: 2, cv: "cv_2", isHuman: false, isMe: true }),
      ev({ id: "c", atMs: 3, cv: "cv_1" }),
    ];
    markUnanswered(events);
    expect(events.find((e) => e.id === "c")!.unanswered).toBe(true);
    expect(events.find((e) => e.id === "b")!.unanswered).toBe(false);
  });
});

describe("computeSignals", () => {
  it("separates human, bot and self events — self must never count as human", () => {
    const s = computeSignals([
      ev({ id: "a", senderId: "u_1" }),
      ev({ id: "b", senderId: "u_2" }),
      ev({ id: "c", isHuman: false, isMe: true, senderId: "bot" }),
      ev({ id: "d", isHuman: false, senderId: "other-bot" }),
    ]);
    expect(s.humanEventCount).toBe(2);
    expect(s.selfEventCount).toBe(1);
    expect(s.botEventCount).toBe(1);
    expect(s.distinctSenders).toBe(2);
  });

  it("ignores questions and action signals raised by the agent itself", () => {
    const s = computeSignals([
      ev({ isHuman: false, isMe: true, question: true, actionSignals: ["urgent"] }),
    ]);
    expect(s.questions).toBe(0);
    expect(s.actionSignals).toBe(0);
  });

  it("counts distinct threads, channels and new threads", () => {
    const s = computeSignals([
      ev({ cv: "cv_1", ch: "ch_1", root: true }),
      ev({ cv: "cv_1", ch: "ch_1" }),
      ev({ cv: "cv_2", ch: "ch_2", root: true }),
    ]);
    expect(s.distinctThreads).toBe(2);
    expect(s.channelsWithActivity).toBe(2);
    expect(s.newThreads).toBe(2);
  });
});
