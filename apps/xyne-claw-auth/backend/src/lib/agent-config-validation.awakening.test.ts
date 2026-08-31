import { describe, expect, it } from "vitest";
import { validateAwakeningConfig } from "./agent-config-validation.js";

const ok = (awakening: unknown) => validateAwakeningConfig({ awakening });

describe("validateAwakeningConfig — accepts", () => {
  it("an absent or empty block", () => {
    expect(validateAwakeningConfig(undefined)).toEqual({ ok: true });
    expect(validateAwakeningConfig({})).toEqual({ ok: true });
    expect(ok(null)).toEqual({ ok: true });
    expect(ok({})).toEqual({ ok: true });
  });

  it("a fully specified valid block", () => {
    expect(
      ok({
        enabled: true,
        kind: "both",
        shadow: false,
        writePolicy: "act",
        periodMs: 1_800_000,
        workspaceId: "ws_1",
        channels: { include: ["ch_1"], includePattern: ["^eng-"], excludePattern: ["-archive$"], maxChannels: 10 },
        gate: { minHumanEvents: 2, forceRunEveryNSkips: 4 },
        limits: { maxEvents: 500, maxActiveThreads: 100, maxRunsPerHour: 6 },
        cursor: { replicaSafetyMs: 15_000, overlapMs: 60_000, maxCatchupWindows: 3 },
      }),
    ).toEqual({ ok: true });
  });
});

describe("validateAwakeningConfig — rejects with a reason", () => {
  it("a non-object block", () => {
    expect(ok("yes").error).toMatch(/awakening must be an object/);
    expect(ok([]).ok).toBe(false);
  });

  it("a period below the floor — a typo must not make an agent wake every second", () => {
    expect(ok({ periodMs: 1000 }).error).toMatch(/periodMs must be an integer between 300000 and 86400000/);
    expect(ok({ periodMs: 60_000 }).ok).toBe(false);
  });

  it("a period above a day", () => {
    expect(ok({ periodMs: 48 * 60 * 60_000 }).ok).toBe(false);
  });

  it("a non-integer period", () => {
    expect(ok({ periodMs: 1_800_000.5 }).ok).toBe(false);
    expect(ok({ periodMs: "30m" }).ok).toBe(false);
  });

  it("an unknown kind or writePolicy", () => {
    expect(ok({ kind: "sideways" }).error).toMatch(/kind must be one of/);
    expect(ok({ writePolicy: "destroy" }).error).toMatch(/writePolicy must be one of/);
  });

  it("a non-boolean enabled / shadow", () => {
    expect(ok({ enabled: "true" }).ok).toBe(false);
    expect(ok({ shadow: 1 }).ok).toBe(false);
  });

  it("an invalid regular expression", () => {
    expect(ok({ channels: { includePattern: ["([a-z"] } }).error).toMatch(/not a valid regular expression/);
  });

  it("a catastrophic-backtracking pattern shape", () => {
    expect(ok({ channels: { includePattern: ["(a+)+$"] } }).error).toMatch(/nested quantifier/);
    expect(ok({ channels: { excludePattern: ["(x*)*"] } }).ok).toBe(false);
  });

  it("an oversized or over-numerous pattern list", () => {
    expect(ok({ channels: { includePattern: ["a".repeat(201)] } }).error).toMatch(/too long/);
    expect(ok({ channels: { includePattern: Array.from({ length: 11 }, (_, i) => `p${i}`) } }).error).toMatch(
      /too many patterns/,
    );
  });

  it("a non-string-array channel list", () => {
    expect(ok({ channels: { include: [1, 2] } }).error).toMatch(/must be an array of strings/);
    expect(ok({ channels: "eng" }).ok).toBe(false);
  });

  it("out-of-range limits and gate values", () => {
    expect(ok({ limits: { maxRunsPerHour: 0 } }).ok).toBe(false);
    expect(ok({ limits: { maxRunsPerHour: 1000 } }).ok).toBe(false);
    expect(ok({ limits: { maxEvents: 1 } }).ok).toBe(false);
    expect(ok({ gate: { minHumanEvents: -1 } }).ok).toBe(false);
    expect(ok({ channels: { maxChannels: 500 } }).ok).toBe(false);
    expect(ok({ cursor: { maxCatchupWindows: 0 } }).ok).toBe(false);
  });

  it("a non-string workspaceId", () => {
    expect(ok({ workspaceId: 42 }).ok).toBe(false);
  });
});
