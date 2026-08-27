import { describe, expect, it } from "vitest";
import { sealWindow, computeNextDueAt, deterministicJitter } from "./cursor.js";
import { AWAKENING_DEFAULTS, type AwakeningConfig } from "./config.js";

const cfg = (over: Partial<AwakeningConfig> = {}): AwakeningConfig => ({
  ...AWAKENING_DEFAULTS,
  ...over,
  cursor: { ...AWAKENING_DEFAULTS.cursor, ...(over.cursor ?? {}) },
});

const NOW = 1_700_000_000_000;

describe("sealWindow — replica safety margin", () => {
  it("never closes a window at now(), always at now - replicaSafetyMs", () => {
    const w = sealWindow(new Date(NOW - 600_000), cfg(), NOW);
    expect(w?.endMs).toBe(NOW - 30_000);
  });

  it("returns null when not enough time has passed to form a window", () => {
    // Watermark is newer than now-safety: sealing would produce an inverted range.
    expect(sealWindow(new Date(NOW - 1_000), cfg(), NOW)).toBeNull();
    expect(sealWindow(new Date(NOW), cfg(), NOW)).toBeNull();
  });

  it("starts exactly at the stored watermark so no gap is left behind", () => {
    const watermark = NOW - 3_600_000;
    const w = sealWindow(new Date(watermark), cfg(), NOW);
    expect(w?.startMs).toBe(watermark);
    expect(w?.gap).toBeNull();
  });
});

describe("sealWindow — gap guard", () => {
  it("clamps a long outage to maxCatchupWindows and reports the skip", () => {
    const config = cfg({ periodMs: 1_800_000, cursor: { ...AWAKENING_DEFAULTS.cursor, maxCatchupWindows: 4 } });
    const weekAgo = NOW - 7 * 24 * 3_600_000;
    const w = sealWindow(new Date(weekAgo), config, NOW);

    const maxSpan = 1_800_000 * 4;
    expect(w).not.toBeNull();
    expect(w!.endMs - w!.startMs).toBe(maxSpan);
    expect(w!.gap).not.toBeNull();
    // Everything between the old watermark and the new start is reported as skipped.
    expect(w!.gap!.skippedMs).toBe(w!.startMs - weekAgo);
  });

  it("does not report a gap when the backlog fits inside the allowance", () => {
    const config = cfg({ periodMs: 1_800_000 });
    const w = sealWindow(new Date(NOW - 3_600_000), config, NOW);
    expect(w!.gap).toBeNull();
  });
});

describe("computeNextDueAt", () => {
  it("is deterministic for the same agent — a beat must not wander across restarts", () => {
    const a = computeNextDueAt("agent_abc", cfg(), 0, NOW);
    const b = computeNextDueAt("agent_abc", cfg(), 0, NOW);
    expect(a.getTime()).toBe(b.getTime());
  });

  it("spreads different agents so a fleet does not stampede one tick", () => {
    const times = new Set(
      Array.from({ length: 50 }, (_, i) => computeNextDueAt(`agent_${i}`, cfg(), 0, NOW).getTime()),
    );
    expect(times.size).toBeGreaterThan(25);
  });

  it("backs off exponentially on repeated failure and caps the factor", () => {
    const period = AWAKENING_DEFAULTS.periodMs;
    const at = (fails: number) => computeNextDueAt("agent_x", cfg(), fails, NOW).getTime() - NOW;
    expect(at(1)).toBeGreaterThanOrEqual(period * 2);
    expect(at(2)).toBeGreaterThanOrEqual(period * 4);
    // Capped at 8x so a recovered agent rejoins its beat promptly.
    expect(at(20)).toBeLessThan(period * 8 + period);
  });

  it("uses no backoff on a healthy agent", () => {
    const delta = computeNextDueAt("agent_y", cfg(), 0, NOW).getTime() - NOW;
    expect(delta).toBeGreaterThanOrEqual(AWAKENING_DEFAULTS.periodMs);
    expect(delta).toBeLessThan(AWAKENING_DEFAULTS.periodMs * 1.11);
  });
});

describe("deterministicJitter", () => {
  it("stays inside the requested range and handles a zero range", () => {
    for (let i = 0; i < 200; i++) {
      const j = deterministicJitter(`agent_${i}`, 1000);
      expect(j).toBeGreaterThanOrEqual(0);
      expect(j).toBeLessThan(1000);
    }
    expect(deterministicJitter("agent", 0)).toBe(0);
    expect(deterministicJitter("agent", -5)).toBe(0);
  });
});
