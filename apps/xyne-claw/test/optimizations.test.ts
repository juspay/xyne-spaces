import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  OPTIMIZATION_KEYS,
  effectiveOptimizations,
  optEnabled,
  parseOptimizationSpec,
  pinRunOptimizations,
} from "../src/optimizations.js";

const ENV = ["XYNE_OPT_ALL", ...OPTIMIZATION_KEYS.map((k) => `XYNE_OPT_${k.toUpperCase()}`)];

describe("optimization switches", () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of ENV) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  const inRun = <T>(spec: unknown, fn: () => T, agentSpec?: unknown): Promise<T> =>
    new Promise((resolve) => {
      setImmediate(() => {
        pinRunOptimizations(spec, agentSpec);
        resolve(fn());
      });
    });

  it("uses each switch's default when nothing overrides it", () => {
    expect(optEnabled("jev_tool_sift")).toBe(true);
    expect(optEnabled("auto_continue_strict")).toBe(false);
  });

  it("turns everything off for a baseline arm and on for an optimized arm", async () => {
    const off = await inRun("none", effectiveOptimizations);
    const on = await inRun("all", effectiveOptimizations);
    expect(Object.values(off).every((v) => v === false)).toBe(true);
    expect(Object.values(on).every((v) => v === true)).toBe(true);
  });

  it("keeps concurrent runs independent", async () => {
    const [a, b] = await Promise.all([
      inRun("none", () => optEnabled("jev_compaction")),
      inRun("all", () => optEnabled("jev_compaction")),
    ]);
    expect([a, b]).toEqual([false, true]);
  });

  it("supports isolating one switch: all but one, or none but one", async () => {
    expect(await inRun("all,-jev_compaction", effectiveOptimizations)).toMatchObject({
      jev_compaction: false,
      jev_tool_sift: true,
    });
    expect(await inRun("none,+jev_tool_sift", effectiveOptimizations)).toMatchObject({
      jev_compaction: false,
      jev_tool_sift: true,
    });
  });

  it("accepts an object map and ignores unknown keys and non-booleans", () => {
    expect(parseOptimizationSpec({ jev_tool_sift: false, bogus: true, jev_compaction: "yes" })).toEqual({
      jev_tool_sift: false,
    });
    expect(parseOptimizationSpec(undefined)).toEqual({});
    expect(parseOptimizationSpec("nonsense,all_the_things")).toEqual({});
  });

  it("lets the per-run pin beat env, and a specific env var beat XYNE_OPT_ALL", async () => {
    process.env["XYNE_OPT_ALL"] = "0";
    expect(optEnabled("jev_tool_sift")).toBe(false);
    process.env["XYNE_OPT_JEV_TOOL_SIFT"] = "1";
    expect(optEnabled("jev_tool_sift")).toBe(true);
    expect(await inRun({ jev_tool_sift: false }, () => optEnabled("jev_tool_sift"))).toBe(false);
  });

  it("applies an agent's own switches, beating env", async () => {
    process.env["XYNE_OPT_ALL"] = "0";
    expect(await inRun(undefined, () => optEnabled("subagent_read_tools"), { subagent_read_tools: true })).toBe(true);
    expect(await inRun(undefined, () => optEnabled("catalog_full_index"), { subagent_read_tools: true })).toBe(false);
  });

  it("lets a per-run pin beat the agent's switches", async () => {
    expect(await inRun({ subagent_read_tools: false }, () => optEnabled("subagent_read_tools"), { subagent_read_tools: true })).toBe(false);
    expect(await inRun("none", effectiveOptimizations, { catalog_full_index: true })).toMatchObject({ catalog_full_index: false });
  });

  it("ignores a malformed agent spec", async () => {
    expect(await inRun(undefined, () => optEnabled("subagent_read_tools"), ["subagent_read_tools"])).toBe(false);
  });
});
