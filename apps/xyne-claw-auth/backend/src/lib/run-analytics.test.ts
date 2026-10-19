import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const runAnalytics = vi.fn(async (_q: Prisma.Sql, _o?: unknown): Promise<unknown[]> => []);
const tx = vi.hoisted(() => ({ row: null as Record<string, unknown> | null, updates: [] as Array<Record<string, unknown>>, events: [] as string[] }));

const persistRunStats = vi.fn(async (..._args: unknown[]) => {
  tx.events.push("stats");
  return { statsRows: 1, toolRows: 0, errorCalls: 0 };
});

vi.mock("../logger.js", () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }));
vi.mock("../redis.js", () => ({ redisService: { getConnection: () => ({ status: "wait" }) } }));
vi.mock("../middleware/agent-acl.js", () => ({ isClawAdmin: vi.fn(), getOrgId: vi.fn(), getRequesterId: vi.fn() }));
vi.mock("./admin-org-scope.js", () => ({ getAdminOrgScope: vi.fn(), getOrgNameMap: vi.fn(async () => new Map([["org-1", "Org One"]])) }));
vi.mock("../db.js", () => {
  const agentRun = {
    findUnique: vi.fn(async () => tx.row),
    updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => (tx.updates.push(data), tx.events.push("update"), { count: 1 })),
  };
  // Raw-statement methods the repository calls on the tx client (the advisory
  // lock) resolve to a no-op; spelling them out here would trip the raw SQL guard.
  const noop = vi.fn(async () => 1);
  const client = new Proxy({ agentRun } as Record<string | symbol, unknown>, {
    get: (t, k) => (typeof k === "string" && k.startsWith("$") && !(k in t) ? noop : t[k]),
  });
  const $transaction = vi.fn(async (fn: (t: typeof client) => unknown) => {
    const out = await fn(client);
    tx.events.push("commit");
    return out;
  });
  return { prisma: { ...client, $transaction } };
});
vi.mock("./metrics-core.js", async (importOriginal) => ({ ...(await importOriginal<typeof import("./metrics-core.js")>()), runAnalytics }));
vi.mock("./tool-stats.js", async (importOriginal) => ({ ...(await importOriginal<typeof import("./tool-stats.js")>()), persistRunStats }));

const ra = await import("./run-analytics.js");
const { agentRunRepository, prepareLlmCalls, settleRunStatsWrites, MAX_STORED_LLM_CALLS } = await import("../repositories/agentRunRepository.js");
type AnalyticsWindow = import("./metrics-core.js").AnalyticsWindow;

const ORPHAN_LITERAL = `(r."error" IS NULL OR r."error" <> 'interrupted (orphaned run)')`;

const INDEX_COLUMNS = new Set([
  "orgId", "completedAt", "id", "status", "agentSlug", "userId", "triggerSource", "startedAt", "parentSessionId", "totalMs",
  "llmTotalMs", "llmDecodeMs", "llmWaitMs", "toolMs", "ttftMs", "tokensPerSec", "tokensIn", "tokensOut",
  "tokensCacheRead", "tokensCacheWrite", "llmTurns", "llmRetries", "provider", "model", "rating",
]);

const STATS_SCALAR_COLUMNS = new Set(["orgId", "completedAt", "agentSlug", "userId", "toolCalls", "toolErrors", "llmCallCount"]);

const statsColumnsRead = (q: Prisma.Sql) => new Set([...q.text.matchAll(/\bs\."([A-Za-z]+)"/g)].map((m) => m[1]!));

const window: AnalyticsWindow = {
  windowStart: new Date("2026-10-08T00:00:00.000Z"), windowEnd: new Date("2026-10-15T00:00:00.000Z"), windowColumn: "completedAt",
  userFilter: Prisma.empty, orgFilter: Prisma.empty, orgId: "org-1", allOrgs: false,
};

const columnsRead = (q: Prisma.Sql) => new Set([...q.text.split(ORPHAN_LITERAL).join("").matchAll(/\br\."([A-Za-z]+)"/g)].map((m) => m[1]!));

const indexOnlyStatements: Array<[string, Prisma.Sql]> = [
  ["summary", ra.runSummarySql(window)],
  ["daily", ra.runDailySql(window, "Asia/Kolkata")],
  ["leaderboard", ra.agentLeaderboardSql(window, 20)],
  ["active agents", ra.activeAgentsSql(window)],
  ["routes", ra.routeTableSql(window)],
];

const statsSummary = ra.statsSummarySql(window, { ...window, windowStart: new Date("2026-10-01T00:00:00.000Z"), windowEnd: window.windowStart });

beforeEach(() => {
  runAnalytics.mockReset().mockResolvedValue([]);
  persistRunStats.mockClear();
  Object.assign(tx, { row: null, updates: [], events: [] });
});

describe("index-only run statements", () => {
  it.each(indexOnlyStatements)("%s reads only covering-index columns and carries the orphan literal and org equality", (_name, q) => {
    expect([...columnsRead(q)].filter((c) => !INDEX_COLUMNS.has(c))).toEqual([]);
    expect(q.text).toContain(ORPHAN_LITERAL);
    expect(q.text).toMatch(/r\."orgId" = \$\d+/);
    expect(q.values).not.toContain("interrupted (orphaned run)");
  });

  it("keeps tool figures out of the run summary and reads tool totals only from the stats scalar columns", () => {
    const summary = ra.runSummarySql(window).text;
    for (const col of ["toolInvocations", "toolStats", "toolCalls", "llmCalls", "agent_run_stats"]) expect(summary).not.toContain(col);
    for (const q of [statsSummary, ra.agentLeaderboardSql(window, 20)]) {
      expect(q.text).toContain('FROM "agent_run_stats" s');
      expect([...statsColumnsRead(q)].filter((c) => !STATS_SCALAR_COLUMNS.has(c))).toEqual([]);
    }
    expect(statsSummary.text).not.toContain("interrupted (orphaned run)");
  });

  it("weights throughput by decode time and times runs by completedAt - startedAt", () => {
    const weighted = /sum\(r\."tokensOut"\)\s+FILTER \(WHERE r\."tokensOut" > 0 AND r\."llmDecodeMs" > 0\)[\s\S]*sum\(r\."llmDecodeMs"\) FILTER/;
    const summary = ra.runSummarySql(window).text;
    expect(summary).toMatch(weighted);
    expect(summary).toContain(`(EXTRACT(EPOCH FROM (r."completedAt" - r."startedAt")) * 1000)) FILTER (WHERE r."status" = 'completed')`);
  });
});

describe("trigger groups", () => {
  it("files sources into groups (unknown to other, never user) and buckets days in a bound zone with grouping sets", () => {
    const q = ra.runDailySql(window, "Asia/Kolkata");
    const { text } = q;
    for (const frag of [`IN ('heartbeat', 'reflex') THEN 'awakened'`, `= 'delegation' THEN 'delegation'`, `IN ('spaces', 'chat', 'app') THEN 'user'`, "ELSE 'other' END", "GROUPING SETS ((s.day), (s.grp), (s.day, s.grp))"]) expect(text).toContain(frag);
    expect(text).toMatch(/r\."triggerSource" IN \('slack'[^)]*\) THEN 'messaging'/);
    expect(text).not.toContain("ELSE 'user'");
    expect(text).toMatch(/AT TIME ZONE 'UTC'\) AT TIME ZONE \$\d+/);
    expect(q.values).toContain("Asia/Kolkata");
  });
});

describe("fetchRunSummary", () => {
  it("computes per-run figures over the runs that recorded them and weights throughput", async () => {
    runAnalytics.mockImplementation(async (q: Prisma.Sql) => {
      if (q.text.includes("cur_series")) {
        return [{ cur_summarised: 9, cur_with_tools: 5, cur_calls: 20, cur_errors: 2, cur_series: 4 }];
      }
      const first = q.values[0];
      if (!(first instanceof Date) || first.getTime() !== window.windowStart.getTime()) return [{ runs: 0 }];
      return [{
        runs: 10, completed: 8, failed: 1, cancelled: 1, delegated: 2, users: 3, wall_n: 8, wall_p50: 1500.4, wall_p95: 9000.6,
        tokens_n: 2, prompt_total: 3000, output_total: 400, fresh_total: 1000, cache_read_total: 1500, cache_write_total: 500,
        tps_n: 2, tps_out: 1000, tps_decode_ms: 4000, turns_n: 2, avg_turns: 3.456,
      }];
    });
    const { current, previous } = await ra.fetchRunSummary(window);
    expect(previous).toBeNull();
    expect(current.successRate).toBeCloseTo(0.8);
    expect(current.wall).toEqual({ n: 8, p50Ms: 1500, p95Ms: 9001 });
    expect(current.tokens.cacheHitRate).toBeCloseTo(0.5);
    expect(current.throughput).toEqual({ n: 2, tokensPerSec: 250 });
    expect(current.tools).toEqual({ runsWithTools: 5, runsSummarised: 9, calls: 20, errors: 2, errorRate: 0.1 });
    expect(current.llm).toEqual({ runsWithSeries: 4, nTurns: 2, avgTurns: 3.46 });
    const runQueries = runAnalytics.mock.calls.map((c) => c[0]).filter((q) => !q.text.includes('"agent_run_stats"'));
    expect(runQueries).toHaveLength(2);
    for (const q of runQueries) expect(q.text).toContain(ORPHAN_LITERAL);
  });

  it("returns null rates, not zero, on an empty window", async () => {
    runAnalytics.mockResolvedValue([{ runs: 0 }]);
    const { current } = await ra.fetchRunSummary(window);
    expect([current.successRate, current.tools.errorRate, current.wall.p50Ms]).toEqual([null, null, null]);
  });
});

describe("fetchRunDaily", () => {
  it("zero-fills every calendar day the window touches in the requested zone", () => {
    const utc = ra.calendarDays(window, "UTC");
    expect([utc[0], utc.at(-1), utc.length]).toEqual(["2026-10-08", "2026-10-14", 7]);
    expect(ra.calendarDays(window, "Asia/Kolkata")).toHaveLength(8);
  });

  it("splits grouping-set rows into day points, per-day trigger counts and trigger rows", async () => {
    runAnalytics.mockResolvedValue([
      { day: "2026-10-09", grp: null, g_day: 0, g_grp: 1, runs: 3, wall_n: 2, wall_p50: 10, wall_p95: 20, agent_n: 0, tokens_n: 1, prompt_total: 50, output_total: 5 },
      { day: "2026-10-09", grp: "awakened", g_day: 0, g_grp: 0, runs: 3 },
      { day: null, grp: "awakened", g_day: 1, g_grp: 0, runs: 3, completed: 2, failed: 1, cancelled: 0, wall_n: 2, wall_p50: 10, wall_p95: 20 },
    ]);
    const { days, triggers } = await ra.fetchRunDaily(window, "UTC");
    expect(days).toHaveLength(7);
    expect(days[1]).toMatchObject({ day: "2026-10-09", runs: 3, byTrigger: { awakened: 3 }, tokens: { n: 1, prompt: 50, output: 5 } });
    expect(triggers).toEqual([{ group: "awakened", runs: 3, completed: 2, failed: 1, cancelled: 0, successRate: 2 / 3, wall: { n: 2, p50Ms: 10, p95Ms: 20 } }]);
  });
});

describe("sentiment + memory recall", () => {
  const agentWindow: AnalyticsWindow = { ...window, agentSlugs: ["xyne"], userId: "u-1" };

  it("binds the apologetic pattern so its backslashes reach Postgres", () => {
    expect(ra.sentimentSql(agentWindow).values).toContain(ra.APOLOGETIC_PATTERN);
    expect(ra.APOLOGETIC_PATTERN.startsWith("\\m(")).toBe(true);
  });

  it("divides retries by the runs whose retry count is known", async () => {
    runAnalytics.mockImplementation(async (q: Prisma.Sql) => {
      if (q.text.includes("total_runs")) return [{ total_runs: 10, rating_up: 1, rating_down: 0, cancelled: 0, failed: 0, retries_known: 2, retried: 1, completed: 10, apologetic: 5 }];
      if (q.text.includes("recalled")) return [{ recalled: 3, captured: true }];
      return [];
    });
    const { sentiment, memoryRecall } = await ra.fetchSentiment(agentWindow);
    expect(sentiment).toMatchObject({ retriedRate: 0.5, retriesKnown: 2, apologeticRate: 0.5 });
    expect(memoryRecall).toEqual({ recalled: 3, runs: 10, rate: 0.3, captured: true });
  });
});

describe("LLM series cap", () => {
  const series = (n: number) => Array.from({ length: n }, (_, i) => ({ i: i + 1, m: i === n - 1 ? "model-last" : "model-a" }));

  it("prepareLlmCalls keeps the first calls, counts the dropped and stores a short series untouched", () => {
    const { calls, dropped, lastModel } = prepareLlmCalls(series(MAX_STORED_LLM_CALLS + 35));
    expect([calls!.length, dropped, lastModel]).toEqual([MAX_STORED_LLM_CALLS, 35, "model-last"]);
    expect(prepareLlmCalls(series(3))).toMatchObject({ dropped: 0, lastModel: "model-last" });
  });
});

describe("finalize", () => {
  const existing = { id: "run-1", orgId: "org-1", toolInvocations: null, toolsUsed: ["t-a"], userId: "u-1", agentSlug: "xyne", metadata: { callbackUrl: "x" } };

  it("summarises a zero-tool run, backs up the model from the series and records a truncated series", async () => {
    tx.row = existing;
    const llmCalls = Array.from({ length: MAX_STORED_LLM_CALLS + 5 }, (_, i) => ({ i: i + 1, m: "open-large" }));
    await agentRunRepository.finalize("s-1", { status: "completed", result: "done", llmCalls });

    const data = tx.updates[0]!;
    expect(data["model"]).toBe("open-large");
    expect(data["metadata"]).toEqual({ callbackUrl: "x", llmCallsDropped: 5 });
    for (const col of ["toolStats", "llmTurnStats", "llmCalls", "toolCalls", "llmCallCount"]) expect(data).not.toHaveProperty(col);

    await settleRunStatsWrites();
    expect(persistRunStats).toHaveBeenCalledTimes(1);
    const [, items] = persistRunStats.mock.calls[0]! as [unknown, Array<{ run: object; summary: { stats: unknown[]; totals: unknown }; llmCalls?: unknown[]; toolsUsed?: unknown }>];
    expect(items).toHaveLength(1);
    const { run, summary, llmCalls: storedCalls, toolsUsed } = items[0]!;
    expect(run).toMatchObject({ id: "run-1", orgId: "org-1", userId: "u-1", agentSlug: "xyne", error: null });
    expect([summary.stats, summary.totals, storedCalls!.length, toolsUsed]).toEqual([[], { calls: 0, errors: 0 }, MAX_STORED_LLM_CALLS, ["t-a"]]);
  });

  it("writes the metrics rows in their own transaction, after the run's has committed", async () => {
    tx.row = existing;
    await agentRunRepository.finalize("s-4", { status: "completed", result: "ok" });
    await settleRunStatsWrites();
    expect(tx.events).toEqual(["update", "commit", "stats", "commit"]);
  });

  it("resolves finalize even when the metrics write fails", async () => {
    tx.row = existing;
    persistRunStats.mockRejectedValueOnce(new Error("stats table unavailable"));
    await expect(agentRunRepository.finalize("s-3", { status: "completed", result: "ok" })).resolves.toEqual({ count: 1 });
    await expect(settleRunStatsWrites()).resolves.toBeUndefined();
    expect(persistRunStats).toHaveBeenCalledTimes(1);
  });
});
