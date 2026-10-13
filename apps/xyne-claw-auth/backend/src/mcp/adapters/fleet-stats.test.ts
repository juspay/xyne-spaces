import { beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.fn();
const isClawAdmin = vi.fn();

vi.mock("../../logger.js", () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
vi.mock("../../db.js", () => ({ prisma: { agentRun: { findMany } } }));
vi.mock("../../middleware/agent-acl.js", () => ({ isClawAdmin }));

const { buildFleetStats, handleGetFleetStats, normalizeError, summarizeBaseline, summarizeToolUsage } = await import("./fleet-stats.js");
type Row = import("./fleet-stats.js").FleetRunRow;

const from = new Date("2026-10-13T00:00:00.000Z");
const to = new Date("2026-10-14T00:00:00.000Z");

function run(over: Partial<Row>): Row {
  return {
    sessionId: "s",
    agentSlug: "a",
    status: "completed",
    provider: "claude",
    model: "opus",
    triggerSource: "spaces",
    durationMs: 10_000,
    llmTotalMs: 6_000,
    llmWaitMs: 1_000,
    llmDecodeMs: 3_000,
    toolMs: 3_000,
    ttftMs: 800,
    tokensPerSec: 60,
    llmTurns: 4,
    llmRetries: 0,
    lastRetryReason: null,
    error: null,
    tokensIn: 1000,
    tokensOut: 200,
    rating: null,
    startedAt: new Date("2026-10-13T10:00:00.000Z"),
    ...over,
  };
}

const base = { from, to, baselineDays: 7, baseline: [], tools: [], topErrors: 15, topTools: 15, maxAgents: 60 };

describe("normalizeError", () => {
  it("collapses ids, urls and numbers so the same failure groups together", () => {
    const a = normalizeError("Provider 429 at https://x.example/v1 after 3021ms (session cmv6ri2th06z23ltfs3dv2qbj)");
    const b = normalizeError("Provider 429 at https://y.example/v2 after 15ms (session cmzzzzzzzzzzzzzzzzzzzzzzzz)");
    expect(a).toBe(b);
    expect(a).toBe("Provider <n> at <url> after <n>ms (session <id>)");
  });

  it("keeps only the first line", () => {
    expect(normalizeError("boom\n    at stack frame")).toBe("boom");
  });
});

describe("buildFleetStats", () => {
  it("aggregates per agent, sorts by failures and compares with the baseline", () => {
    const stats = buildFleetStats({
      ...base,
      runs: [
        run({ sessionId: "1", agentSlug: "fast", durationMs: 2_000 }),
        run({ sessionId: "2", agentSlug: "fast", durationMs: 4_000 }),
        run({ sessionId: "3", agentSlug: "flaky", status: "failed", error: "timeout after 300s" }),
        run({ sessionId: "4", agentSlug: "flaky", status: "failed", error: "timeout after 120s" }),
        run({ sessionId: "5", agentSlug: "flaky", durationMs: 30_000 }),
        run({ sessionId: "6", agentSlug: "flaky", status: "cancelled", error: "interrupted (orphaned run)" }),
      ],
      baseline: [{ agentSlug: "flaky", runs: 70, failed: 7, p50Ms: 20_000, p95Ms: 20_000 }],
    }) as Record<string, any>;

    expect(stats.overall).toMatchObject({ runs: 5, failed: 2, completed: 3, orphanedExcluded: 1, failedPct: 40, activeAgents: 2 });
    expect(stats.agents.map((a: { agentSlug: string }) => a.agentSlug)).toEqual(["flaky", "fast"]);
    const flaky = stats.agents[0];
    expect(flaky).toMatchObject({ runs: 3, failed: 2, failedPct: 66.7, p95S: 30 });
    expect(flaky.baseline).toEqual({ runsPerWindow: 10, failedPct: 10, p50S: 20, p95S: 20 });
    expect(flaky.p95ChangePct).toBe(50);
    expect(flaky.failedPctChange).toBe(56.7);
    expect(stats.agents[1]).toMatchObject({ p50S: 3, baseline: null, p95ChangePct: null });
  });

  it("groups normalised errors with counts, agents and example sessions", () => {
    const stats = buildFleetStats({
      ...base,
      runs: [
        run({ sessionId: "1", agentSlug: "x", status: "failed", error: "timeout after 300s" }),
        run({ sessionId: "2", agentSlug: "y", status: "failed", error: "timeout after 120s" }),
        run({ sessionId: "3", agentSlug: "y", status: "failed", error: "timeout after 9s" }),
        run({ sessionId: "4", agentSlug: "y", status: "failed", error: "sandbox claim failed" }),
      ],
    }) as Record<string, any>;
    expect(stats.distinctErrors).toBe(2);
    expect(stats.errors[0]).toMatchObject({ message: "timeout after <n>s", count: 3, agents: ["x", "y"], exampleSessions: ["1", "2"] });
  });

  it("names the dominant cause for the slowest agents", () => {
    const slow = Array.from({ length: 3 }, (_, i) =>
      run({ sessionId: `s${i}`, agentSlug: "slow", durationMs: 100_000, llmTotalMs: 20_000, llmWaitMs: 15_000, llmDecodeMs: 5_000, toolMs: 75_000 }),
    );
    const stats = buildFleetStats({
      ...base,
      runs: [...slow, run({ agentSlug: "rare", durationMs: 900_000 })],
    }) as Record<string, any>;
    expect(stats.slowestAgents).toHaveLength(1);
    expect(stats.slowestAgents[0].agentSlug).toBe("slow");
    expect(stats.slowestAgents[0].likelyCause).toMatch(/^tool calls — 75% of run time/);
  });

  it("reports provider health per provider and model", () => {
    const stats = buildFleetStats({
      ...base,
      runs: [
        run({ provider: "codex", model: "gpt", status: "failed", error: "429", llmRetries: 2, lastRetryReason: "rate limited" }),
        run({ provider: "codex", model: "gpt" }),
        run({ provider: "claude", model: "opus" }),
      ],
    }) as Record<string, any>;
    expect(stats.providers[0]).toMatchObject({
      provider: "codex",
      model: "gpt",
      runs: 2,
      failed: 1,
      failedPct: 50,
      llmRetries: 2,
      topRetryReasons: [{ value: "rate limited", count: 1 }],
    });
  });
});

describe("summarizeBaseline", () => {
  it("counts runs and failures and takes percentiles of completed runs, skipping orphans", () => {
    const t = (s: number) => new Date(Date.UTC(2026, 9, 10, 0, 0, s));
    const rows = summarizeBaseline([
      { agentSlug: "a", status: "completed", error: null, startedAt: t(0), completedAt: t(10) },
      { agentSlug: "a", status: "completed", error: null, startedAt: t(0), completedAt: t(30) },
      { agentSlug: "a", status: "failed", error: "x", startedAt: t(0), completedAt: t(5) },
      { agentSlug: "a", status: "cancelled", error: "interrupted (orphaned run)", startedAt: t(0), completedAt: null },
    ]);
    expect(rows).toEqual([{ agentSlug: "a", runs: 3, failed: 1, p50Ms: 20_000, p95Ms: 29_000 }]);
  });
});

describe("summarizeToolUsage", () => {
  it("counts runs using each tool once per run, with the agents that used it", () => {
    const rows = summarizeToolUsage([
      { agentSlug: "a", toolsUsed: ["webfetch", "webfetch", "sandbox-run"] },
      { agentSlug: "b", toolsUsed: ["webfetch", ""] },
      { agentSlug: "c", toolsUsed: null },
    ]).sort((x, y) => x.tool.localeCompare(y.tool));
    expect(rows).toEqual([
      { tool: "sandbox-run", calls: 1, errors: 0, p50Ms: null, p95Ms: null, agents: ["a"] },
      { tool: "webfetch", calls: 2, errors: 0, p50Ms: null, p95Ms: null, agents: ["a", "b"] },
    ]);
  });
});

describe("handleGetFleetStats", () => {
  beforeEach(() => {
    findMany.mockReset();
    isClawAdmin.mockReset();
  });

  it("refuses non-admins without querying", async () => {
    isClawAdmin.mockResolvedValue(false);
    const out = JSON.parse(await handleGetFleetStats({}, "org", "user"));
    expect(out.error).toMatch(/claw admins/);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("requires an org and a requester", async () => {
    expect(JSON.parse(await handleGetFleetStats({}, undefined, "user")).error).toMatch(/contextOrgId/);
    expect(JSON.parse(await handleGetFleetStats({}, "org", undefined)).error).toMatch(/claw admins/);
  });

  it("scopes every query to the org and clamps params", async () => {
    isClawAdmin.mockResolvedValue(true);
    const started = new Date(Date.now() - 3_600_000);
    findMany
      .mockResolvedValueOnce([
        {
          sessionId: "s1", agentSlug: "a", status: "completed", provider: "claude", model: "opus", triggerSource: "spaces",
          startedAt: started, completedAt: new Date(started.getTime() + 12_000), totalMs: null, llmTotalMs: 6000,
          llmWaitMs: null, llmDecodeMs: null, toolMs: 4000, ttftMs: null, tokensPerSec: null, llmTurns: 3, llmRetries: 0,
          lastRetryReason: null, error: null, tokensIn: 10, tokensOut: 5, rating: "up", toolsUsed: ["webfetch"],
        },
      ])
      .mockResolvedValueOnce([
        { agentSlug: "a", status: "completed", error: null, startedAt: started, completedAt: new Date(started.getTime() + 12_000) },
      ]);
    const out = JSON.parse(await handleGetFleetStats({ hours: 999, baselineDays: 0, agentSlugs: ["a", " ", 3] }, "org", "admin"));
    expect(out.window.hours).toBe(168);
    expect(out.baselineDays).toBe(1);
    expect(out.agents[0]).toMatchObject({ agentSlug: "a", runs: 1, p50S: 12, ratingsUp: 1, p95ChangePct: 0 });
    expect(out.tools[0]).toEqual({ tool: "webfetch", runsUsing: 1, agents: ["a"] });
    expect(out.agents[0]).not.toHaveProperty("toolsUsed");
    expect(findMany).toHaveBeenCalledTimes(2);
    for (const [arg] of findMany.mock.calls) {
      expect(arg.where).toMatchObject({ orgId: "org", agentSlug: { in: ["a"] } });
    }
  });
});
