import { describe, expect, it } from "vitest";
import { resolveAwakeningConfig, hashChannelRules, participatesIn, AWAKENING_DEFAULTS } from "./config.js";

describe("resolveAwakeningConfig — never throws, always in bounds", () => {
  it("returns defaults for missing / non-object config", () => {
    expect(resolveAwakeningConfig(undefined)).toEqual(AWAKENING_DEFAULTS);
    expect(resolveAwakeningConfig(null)).toEqual(AWAKENING_DEFAULTS);
    expect(resolveAwakeningConfig({})).toEqual(AWAKENING_DEFAULTS);
    expect(resolveAwakeningConfig({ awakening: "nope" })).toEqual(AWAKENING_DEFAULTS);
    expect(resolveAwakeningConfig({ awakening: [] })).toEqual(AWAKENING_DEFAULTS);
  });

  it("defaults to safe values: disabled, shadow on, reply-only", () => {
    expect(AWAKENING_DEFAULTS.enabled).toBe(false);
    expect(AWAKENING_DEFAULTS.shadow).toBe(true);
    expect(AWAKENING_DEFAULTS.writePolicy).toBe("reply");
  });

  it("clamps an out-of-range period rather than throwing", () => {
    expect(resolveAwakeningConfig({ awakening: { periodMs: 1 } }).periodMs).toBe(5 * 60_000);
    expect(resolveAwakeningConfig({ awakening: { periodMs: 999 * 60 * 60_000 } }).periodMs).toBe(24 * 60 * 60_000);
    expect(resolveAwakeningConfig({ awakening: { periodMs: "30m" } }).periodMs).toBe(AWAKENING_DEFAULTS.periodMs);
    expect(resolveAwakeningConfig({ awakening: { periodMs: NaN } }).periodMs).toBe(AWAKENING_DEFAULTS.periodMs);
  });

  it("drops uncompilable channel patterns instead of failing the whole read", () => {
    const cfg = resolveAwakeningConfig({
      awakening: { channels: { includePattern: ["^eng-", "([a-z]+", "ops$"] } },
    });
    expect(cfg.channels.includePattern).toEqual(["^eng-", "ops$"]);
  });

  it("drops oversized patterns and caps pattern count", () => {
    const long = "a".repeat(201);
    expect(resolveAwakeningConfig({ awakening: { channels: { includePattern: [long] } } }).channels.includePattern).toEqual([]);
    const many = Array.from({ length: 30 }, (_, i) => `p${i}`);
    expect(resolveAwakeningConfig({ awakening: { channels: { includePattern: many } } }).channels.includePattern).toHaveLength(10);
  });

  it("de-duplicates and trims channel id lists, ignoring non-strings", () => {
    const cfg = resolveAwakeningConfig({
      awakening: { channels: { include: [" ch_1 ", "ch_1", "", 42, "ch_2"] } },
    });
    expect(cfg.channels.include).toEqual(["ch_1", "ch_2"]);
  });

  it("falls back on an unknown kind or writePolicy", () => {
    expect(resolveAwakeningConfig({ awakening: { kind: "sideways" } }).kind).toBe("heartbeat");
    expect(resolveAwakeningConfig({ awakening: { writePolicy: "destroy" } }).writePolicy).toBe("reply");
  });

  it("keeps a valid full config intact", () => {
    const cfg = resolveAwakeningConfig({
      awakening: {
        enabled: true,
        kind: "both",
        periodMs: 900_000,
        shadow: false,
        writePolicy: "act",
        workspaceId: " ws_1 ",
        channels: { include: ["ch_a"], includePattern: ["^eng"], maxChannels: 10 },
        gate: { minHumanEvents: 3, forceRunEveryNSkips: 5 },
        limits: { maxEvents: 200, maxActiveThreads: 50, maxRunsPerHour: 6 },
        cursor: { replicaSafetyMs: 10_000, overlapMs: 60_000, maxCatchupWindows: 2 },
      },
    });
    expect(cfg.enabled).toBe(true);
    expect(cfg.kind).toBe("both");
    expect(cfg.workspaceId).toBe("ws_1");
    expect(cfg.gate.minHumanEvents).toBe(3);
    expect(cfg.limits.maxRunsPerHour).toBe(6);
    expect(cfg.cursor.overlapMs).toBe(60_000);
  });
});

describe("hashChannelRules", () => {
  it("is order-insensitive so a reordered list does not bust the cache", () => {
    const a = { include: ["b", "a"], includePattern: [], exclude: [], excludePattern: [], maxChannels: 25 };
    const b = { include: ["a", "b"], includePattern: [], exclude: [], excludePattern: [], maxChannels: 25 };
    expect(hashChannelRules(a)).toBe(hashChannelRules(b));
  });

  it("changes when any rule changes", () => {
    const base = { include: ["a"], includePattern: [], exclude: [], excludePattern: [], maxChannels: 25 };
    expect(hashChannelRules(base)).not.toBe(hashChannelRules({ ...base, include: ["a", "c"] }));
    expect(hashChannelRules(base)).not.toBe(hashChannelRules({ ...base, maxChannels: 10 }));
    expect(hashChannelRules(base)).not.toBe(hashChannelRules({ ...base, excludePattern: ["x"] }));
  });
});

describe("participatesIn", () => {
  it("routes each kind correctly", () => {
    const cfg = (kind: "heartbeat" | "reflex" | "both") => ({ ...AWAKENING_DEFAULTS, kind });
    expect(participatesIn(cfg("heartbeat"), "heartbeat")).toBe(true);
    expect(participatesIn(cfg("heartbeat"), "reflex")).toBe(false);
    expect(participatesIn(cfg("reflex"), "heartbeat")).toBe(false);
    expect(participatesIn(cfg("both"), "heartbeat")).toBe(true);
    expect(participatesIn(cfg("both"), "reflex")).toBe(true);
  });
});
