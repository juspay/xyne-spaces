import { describe, expect, it, vi } from "vitest";

vi.mock("../repositories/agentRunRepository.js", () => ({ agentRunRepository: { toolUsageRank: vi.fn() } }));
vi.mock("../logger.js", () => ({ createLogger: () => ({ warn: vi.fn(), info: vi.fn() }) }));

import { createToolUsageRankCache, TOOL_USAGE_RANK_LIMIT, TOOL_USAGE_WINDOW_MS, wantsToolUsageRank } from "./tool-usage-rank.js";

describe("tool usage rank cache", () => {
  it("asks for the last 7 days and caches per agent for an hour", async () => {
    let t = 1_000_000_000_000;
    const load = vi.fn().mockResolvedValue(["sandbox-run", "webfetch"]);
    const cache = createToolUsageRankCache(load, () => t);
    expect(await cache.lookup("xyne-spaces-architect", "org1")).toEqual(["sandbox-run", "webfetch"]);
    expect(load).toHaveBeenCalledWith("xyne-spaces-architect", "org1", new Date(t - TOOL_USAGE_WINDOW_MS), TOOL_USAGE_RANK_LIMIT);
    t += 59 * 60 * 1000;
    await cache.lookup("xyne-spaces-architect", "org1");
    expect(load).toHaveBeenCalledTimes(1);
    t += 2 * 60 * 1000;
    await cache.lookup("xyne-spaces-architect", "org1");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("keeps agents and orgs apart", async () => {
    const load = vi.fn(async (slug: string, org: string) => [`${org}/${slug}`]);
    const cache = createToolUsageRankCache(load);
    expect(await cache.lookup("a", "o1")).toEqual(["o1/a"]);
    expect(await cache.lookup("a", "o2")).toEqual(["o2/a"]);
    expect(await cache.lookup("b", "o1")).toEqual(["o1/b"]);
  });

  it("shares one query between concurrent run starts", async () => {
    let release!: (v: string[]) => void;
    const load = vi.fn(() => new Promise<string[]>((r) => (release = r)));
    const cache = createToolUsageRankCache(load);
    const both = Promise.all([cache.lookup("a", "o"), cache.lookup("a", "o")]);
    release(["x"]);
    expect(await both).toEqual([["x"], ["x"]]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("runs without a rank when the query fails, and keeps a stale rank when it has one", async () => {
    let t = 0;
    const load = vi.fn().mockResolvedValueOnce(["old"]).mockRejectedValue(new Error("db down"));
    const cache = createToolUsageRankCache(load, () => t);
    expect(await createToolUsageRankCache(vi.fn().mockRejectedValue(new Error("db down"))).lookup("a", "o")).toEqual([]);
    expect(await cache.lookup("a", "o")).toEqual(["old"]);
    t += 2 * 60 * 60 * 1000;
    expect(await cache.lookup("a", "o")).toEqual(["old"]);
  });

  it("gives up on a slow query instead of holding the run start", async () => {
    vi.useFakeTimers();
    try {
      const cache = createToolUsageRankCache(() => new Promise<string[]>(() => {}));
      const pending = cache.lookup("a", "o");
      await vi.advanceTimersByTimeAsync(1600);
      expect(await pending).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("which runs need the usage rank", () => {
  it("follows the agent's switch", () => {
    expect(wantsToolUsageRank({ active_tool_cap: true }, undefined)).toBe(true);
    expect(wantsToolUsageRank({ subagent_read_tools: true }, undefined)).toBe(false);
    expect(wantsToolUsageRank(undefined, undefined)).toBe(false);
  });

  it("lets a per-run spec win over the agent's switch", () => {
    expect(wantsToolUsageRank({ active_tool_cap: true }, "none")).toBe(false);
    expect(wantsToolUsageRank({ active_tool_cap: true }, "all,-active_tool_cap")).toBe(false);
    expect(wantsToolUsageRank(undefined, "all")).toBe(true);
    expect(wantsToolUsageRank(undefined, "+active_tool_cap")).toBe(true);
    expect(wantsToolUsageRank({ active_tool_cap: true }, "jev_tool_sift")).toBe(true);
  });
});
