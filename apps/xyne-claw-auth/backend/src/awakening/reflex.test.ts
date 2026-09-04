import { describe, expect, it } from "vitest";
import { decideReflex, renderInjection, type ReflexContext } from "./reflex.js";
import { AWAKENING_DEFAULTS, type AwakeningConfig } from "./config.js";

const cfg = (over: Partial<AwakeningConfig["reflex"]> = {}): AwakeningConfig => ({
  ...AWAKENING_DEFAULTS,
  reflex: { ...AWAKENING_DEFAULTS.reflex, ...over },
});

const ctx = (over: Partial<ReflexContext> = {}): ReflexContext => ({
  count: 0,
  config: cfg(),
  busyWithSessionId: null,
  sinceLastRunMs: Number.POSITIVE_INFINITY,
  injectionsUsed: 0,
  sinceLastInjectionMs: Number.POSITIVE_INFINITY,
  ...over,
});

describe("idle agent — deciding whether to fire", () => {
  it("waits below the threshold", () => {
    expect(decideReflex(ctx({ count: 24, config: cfg({ threshold: 25 }) }))).toEqual({ action: "wait", count: 24 });
  });

  it("fires exactly at the threshold", () => {
    expect(decideReflex(ctx({ count: 25, config: cfg({ threshold: 25 }) }))).toEqual({ action: "fire", count: 25 });
  });

  it("fires above the threshold", () => {
    expect(decideReflex(ctx({ count: 500, config: cfg({ threshold: 25 }) })).action).toBe("fire");
  });

  it("holds when the minimum gap between reflex runs has not elapsed", () => {
    const d = decideReflex(
      ctx({ count: 100, config: cfg({ threshold: 25, minIntervalMs: 300_000 }), sinceLastRunMs: 60_000 }),
    );
    expect(d).toEqual({ action: "hold", count: 100, reason: "min_interval" });
  });

  it("fires once the minimum gap has elapsed", () => {
    const d = decideReflex(
      ctx({ count: 100, config: cfg({ threshold: 25, minIntervalMs: 300_000 }), sinceLastRunMs: 300_000 }),
    );
    expect(d.action).toBe("fire");
  });

  it("never waits on a zero threshold floor — count 0 still waits", () => {
    expect(decideReflex(ctx({ count: 0, config: cfg({ threshold: 1 }) })).action).toBe("wait");
  });
});

/**
 * The single most important property in this file: while a run is in flight,
 * NOTHING may start a second one. Two concurrent awakened runs on one agent
 * read overlapping windows and both post.
 */
describe("busy agent — never starts a second run", () => {
  const busy = { busyWithSessionId: "sess_1" };

  it("injects instead of firing when the injection threshold is met", () => {
    const d = decideReflex(ctx({ ...busy, count: 10, config: cfg({ threshold: 25, injectThreshold: 10 }) }));
    expect(d).toEqual({ action: "inject", count: 10, sessionId: "sess_1" });
  });

  it("does not fire even when the RUN threshold is massively exceeded", () => {
    const d = decideReflex(ctx({ ...busy, count: 10_000, config: cfg({ threshold: 25 }) }));
    expect(d.action).not.toBe("fire");
    expect(d.action).toBe("inject");
  });

  it("waits below the injection threshold", () => {
    expect(decideReflex(ctx({ ...busy, count: 3, config: cfg({ injectThreshold: 10 }) })).action).toBe("wait");
  });

  it("holds once the per-session injection cap is reached", () => {
    const d = decideReflex(
      ctx({ ...busy, count: 100, config: cfg({ injectThreshold: 10, maxInjectionsPerSession: 3 }), injectionsUsed: 3 }),
    );
    expect(d).toEqual({ action: "hold", count: 100, reason: "injection_cap_reached" });
  });

  it("holds inside the minimum gap between injections", () => {
    const d = decideReflex(
      ctx({
        ...busy,
        count: 100,
        config: cfg({ injectThreshold: 10, injectMinIntervalMs: 60_000 }),
        sinceLastInjectionMs: 10_000,
      }),
    );
    expect(d).toEqual({ action: "hold", count: 100, reason: "injection_min_interval" });
  });

  it("holds when injection is switched off entirely", () => {
    const d = decideReflex(ctx({ ...busy, count: 100, config: cfg({ injectEnabled: false }) }));
    expect(d).toEqual({ action: "hold", count: 100, reason: "injection_disabled" });
  });

  it("a cap of 0 disables injection from the very first batch", () => {
    const d = decideReflex(
      ctx({ ...busy, count: 100, config: cfg({ injectThreshold: 1, maxInjectionsPerSession: 0 }) }),
    );
    expect(d).toEqual({ action: "hold", count: 100, reason: "injection_cap_reached" });
  });

  it("injects again once the gap has passed and budget remains", () => {
    const d = decideReflex(
      ctx({
        ...busy,
        count: 50,
        config: cfg({ injectThreshold: 10, maxInjectionsPerSession: 3, injectMinIntervalMs: 60_000 }),
        injectionsUsed: 1,
        sinceLastInjectionMs: 90_000,
      }),
    );
    expect(d.action).toBe("inject");
  });
});

describe("renderInjection", () => {
  it("numbers the update and states the remaining budget", () => {
    const text = renderInjection(1, 12, 2, ["- thread A: 5 msgs"]);
    expect(text).toContain("[Live update 1 — 12 new event(s) arrived while you were working]");
    expect(text).toContain("up to 2 more live update(s)");
    expect(text).toContain("- thread A: 5 msgs");
  });

  it("says plainly when it is the final update, so the agent stops waiting for more", () => {
    const text = renderInjection(3, 4, 0, []);
    expect(text).toContain("LAST live update");
    expect(text).not.toContain("more live update(s) in this run");
  });

  it("tells the agent it need not acknowledge the update", () => {
    expect(renderInjection(1, 1, 1, [])).toContain("do not need to acknowledge");
  });
});
