/** get_agent_metrics / find_metric_sessions. The real metrics-core scope builder and cache run; only the DB, Redis and analytics readers are faked. */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Fns<A extends unknown[] = []> = A["length"] extends 13 ? A : Fns<[...A, ReturnType<typeof vi.fn>]>;
const [agentFindUnique, agentFindMany, userFindUnique, isClawAdmin, fetchRunSummary, fetchAgentLeaderboard, fetchToolRollup, fetchToolStatsCoverage, fetchErrorClasses, fetchUnusedGrants, fetchLlmCalls, fetchMetricSessions, userIdAliasesFor] = Array.from({ length: 13 }, () => vi.fn()) as unknown as Fns;

vi.mock("../../logger.js", () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }));
vi.mock("../../db.js", () => ({
  prisma: {
    agent: { findUnique: agentFindUnique, findMany: agentFindMany },
    user: { findUnique: userFindUnique },
    agentRun: { findMany: vi.fn() },
  },
}));
vi.mock("../../middleware/agent-acl.js", () => ({ isClawAdmin, getOrgId: () => undefined, getRequesterId: () => undefined }));
vi.mock("../../redis.js", () => ({ redisService: { getConnection: () => ({ status: "wait" }) } }));
vi.mock("../../config.js", () => ({ CONFIG: { frontendUrl: "https://claw.example/claw/" } }));
vi.mock("../../lib/run-analytics.js", () => ({ fetchRunSummary, fetchAgentLeaderboard }));
vi.mock("../../lib/tool-analytics.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/tool-analytics.js")>()),
  fetchToolRollup,
  fetchToolStatsCoverage,
  fetchErrorClasses,
  fetchUnusedGrants,
}));
vi.mock("../../lib/llm-call-analytics.js", () => ({ fetchLlmCalls }));
vi.mock("../../lib/metric-sessions.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/metric-sessions.js")>()),
  fetchMetricSessions,
}));
vi.mock("../../lib/users-jit.js", () => ({ userIdAliasesFor }));
vi.mock("../../services/agent-index/index.js", () => ({ findAgents: vi.fn(), INDEX_KINDS: ["usage", "persona", "identity"] }));
vi.mock("../../services/tool-index/index.js", () => ({ listTools: vi.fn(), searchTools: vi.fn() }));

const m = await import("./agent-metrics.js");
const { invalidateMetricsCache, snapDays } = await import("../../lib/metrics-core.js");
const { MetricsBadRequestError } = await import("../../lib/tool-analytics.js");
const { decodeCursor } = await import("../../lib/metric-sessions.js");
const { AGENT_INTROSPECT_TOOLS, handleAgentIntrospect } = await import("./agent-introspect.js");

type Summary = import("../../lib/run-analytics.js").SummaryFigures;
type ToolRow = import("../../lib/tool-analytics.js").ToolRow;
type SessionRow = import("../../lib/metric-sessions.js").MetricSessionRow;
type AnalyticsWindow = import("../../lib/metrics-core.js").AnalyticsWindow;
const ORG = "org_a";
const ME = "user_me";
const pct = (n: number) => ({ n, p50Ms: 1_000, p95Ms: 2_000 });

const summary = (over: Partial<Summary> = {}): Summary => ({
  runs: 356, delegatedRuns: 0, completed: 340, failed: 12, cancelled: 4, successRate: 340 / 356, users: 3,
  wall: pct(340), agent: { ...pct(340), avgLlmMs: 7_000, avgToolMs: 3_000, avgOtherMs: 1_000 }, replyStart: pct(340),
  tokens: { n: 340, promptPerRun: 4_590, outputPerRun: 210, freshPerRun: 1_000, cachedPerRun: 3_590, cacheHitRate: 0.41, promptTotal: 1, outputTotal: 1, freshTotal: 1, cacheReadTotal: 1, cacheWriteTotal: 0 },
  throughput: { n: 300, tokensPerSec: 80 },
  tools: { runsWithTools: 300, runsSummarised: 340, calls: 2_210, errors: 61, errorRate: 61 / 2_210 },
  llm: { runsWithSeries: 340, nTurns: 340, avgTurns: 4 },
  ...over,
});

const toolRow = (tool: string, over: Partial<ToolRow> = {}): ToolRow => ({
  tool, calls: 100, runs: 40, topLevelCalls: 100, childCalls: 0, errors: 8, errorRate: 0.08, notFound: 0, dropped: 0, droppedRate: 0,
  empty: 0, emptyRate: 0, duplicates: 0, duplicateRate: 0, recovered: 3, recoveryRate: 3 / 8, unrecovered: 5, citeable: 0, cited: 0,
  citeRate: null, timedCalls: 100, avgMs: 400, p50Ms: 250, p95Ms: 2_500, p95Overflow: false, maxMs: 9_000, totalMs: 40_000, bytes: 100_000,
  avgBytes: 1_000, contextShare: 0.1, sessions: { errored: 6, recovered: 3, unrecovered: 4, dropped: 0, duplicated: 0, empty: 0, cited: 0 },
  ...over,
});

const rollup = (rows: ToolRow[]) => ({
  totals: { distinctTools: rows.length, calls: 0, errors: 0, notFound: 0, dropped: 0, duplicates: 0, empty: 0, recovered: 0, citeable: 0, cited: 0, bytes: 0, totalMs: 0, timedCalls: 0, avgMsPerCall: 400, runsWithTools: 40 },
  rows,
});

const sessionRow = (i: number, over: Partial<SessionRow> = {}): SessionRow => {
  const completedAt = new Date(Date.UTC(2026, 9, 14, 12, 0, 0) - i * 60_000).toISOString();
  return {
    id: `run_${i}`, sessionId: `sess_${i}`, conversationId: null, channelId: null, agentSlug: "xyne", userId: ME, userName: "Me Person",
    userEmail: "me@example.com", triggerSource: "chat", status: "completed", task: "summarise the release notes",
    startedAt: new Date(Date.parse(completedAt) - 20_000).toISOString(), completedAt, durationMs: 20_000, totalMs: 19_000, tokensIn: 100, tokensOut: 50,
    rating: null, restricted: false, tool: { c: 3, e: 2, rec: 1, unrec: 1, d: 0, dup: 0, z: 0, ci: 0, nf: 0, ms: 900 }, sample: "HTTP 429 from upstream",
    ...over,
  };
};
const pageOf = (rows: SessionRow[], over = {}) => ({
  rows, page: { limit: 10, nextCursor: null, hasMore: false }, total: { value: rows.length, capped: false }, coverage: { runsInWindow: 10, runsSummarised: 10 }, ...over,
});
const parse = (s: string) => JSON.parse(s) as Record<string, any>;
const lastWindow = (fn: ReturnType<typeof vi.fn>): AnalyticsWindow => fn.mock.calls.at(-1)![0] as AnalyticsWindow;
const metrics = async (args: Record<string, unknown> = {}) => parse(await m.handleGetAgentMetrics(args, ORG, ME));
const sessions = async (args: Record<string, unknown>) => parse(await m.handleFindMetricSessions(args, ORG, ME));
const analyticsCalls = () =>
  [fetchRunSummary, fetchAgentLeaderboard, fetchToolRollup, fetchToolStatsCoverage, fetchErrorClasses, fetchUnusedGrants, fetchLlmCalls, fetchMetricSessions]
    .reduce((n, f) => n + f.mock.calls.length, 0);

beforeEach(async () => {
  vi.clearAllMocks();
  await invalidateMetricsCache();
  isClawAdmin.mockResolvedValue(false);
  userFindUnique.mockResolvedValue({ orgId: ORG });
  agentFindUnique.mockImplementation(async ({ where }: { where: { orgId_slug: { slug: string } } }) => (where.orgId_slug.slug === "xyne" ? { slug: "xyne" } : null));
  agentFindMany.mockResolvedValue([{ slug: "xyne" }, { slug: "orchestrator" }, { slug: "daily-brief" }]);
  fetchRunSummary.mockResolvedValue({ current: summary(), previous: summary({ runs: 4, completed: 4, successRate: 1, wall: pct(4) }) });
  fetchAgentLeaderboard.mockResolvedValue([]);
  fetchToolRollup.mockResolvedValue(rollup([toolRow("webfetch"), toolRow("spaces-search", { errors: 33, calls: 410 })]));
  fetchToolStatsCoverage.mockResolvedValue({ runsInWindow: 356, runsSummarised: 340, coverage: 340 / 356 });
  fetchErrorClasses.mockResolvedValue({ rows: [], total: 0, occurrences: 0 });
  fetchUnusedGrants.mockResolvedValue({ agents: [], unusedGrants: [] });
  fetchMetricSessions.mockResolvedValue(pageOf([]));
  userIdAliasesFor.mockResolvedValue([ME, "spaces_me"]);
});

describe("refusals and validation (fail closed, before any query)", () => {
  it.each([[undefined, ME], [ORG, undefined]])("both tools refuse without org=%s / user=%s", async (org, user) => {
    for (const handler of [m.handleGetAgentMetrics, m.handleFindMetricSessions]) {
      expect(parse(await handler({ kind: "run_failed" }, org, user))["error"]).toMatch(/unavailable/);
    }
    expect(analyticsCalls()).toBe(0);
    expect(isClawAdmin).not.toHaveBeenCalled();
  });

  it.each([
    ["get_agent_metrics", { view: "bogus" }, /view must be one of overview, tools/],
    ["get_agent_metrics", { view: "tools", sortBy: "speed" }, /sortBy must be one of/],
    ["get_agent_metrics", { view: "tool_failures" }, /`tool` is required/],
    ["find_metric_sessions", { kind: "everything" }, /kind must be one of tool_errored/],
    ["find_metric_sessions", { kind: "tool_errored" }, /`tool` is required/],
    ["find_metric_sessions", { kind: "tool_called", tool: "x".repeat(201) }, /too long/],
  ] as const)("%s rejects %j", async (tool, args, message) => {
    const out = tool === "get_agent_metrics" ? await metrics(args) : await sessions(args);
    expect(out["error"]).toMatch(message);
    expect(analyticsCalls()).toBe(0);
    expect(agentFindUnique).not.toHaveBeenCalled();
  });

  it.each([[undefined, 7], [90, 30], [3, 1], [14, 7], ["30", 30], ["abc", 7]] as const)("days %s snaps to %s", async (days, expected) => {
    expect(snapDays(days)).toBe(expected);
    expect((await metrics({ days }))["window"]["days"]).toBe(expected);
    const w = lastWindow(fetchRunSummary);
    expect(w.windowEnd.getTime() - w.windowStart.getTime()).toBe(expected * 86_400_000);
  });
});

describe("scope", () => {
  it("non-admin sees only their own runs, and the response says so", async () => {
    const out = await metrics();
    expect(lastWindow(fetchRunSummary)).toMatchObject({ orgId: ORG, userId: ME, allOrgs: false });
    expect(out["scope"]).toMatchObject({ level: "own", note: "your own runs only" });
    expect(out["caveats"]).toContain("Scope is your own runs only; org-wide figures need a claw admin of this organization.");
  });

  it("admin of the context org gets the whole org", async () => {
    isClawAdmin.mockResolvedValue(true);
    const out = await metrics();
    expect(lastWindow(fetchRunSummary).userId).toBeUndefined();
    expect(out["scope"]["level"]).toBe("org");
  });

  it("an admin of ANOTHER org running this org's agent is downgraded to own runs", async () => {
    isClawAdmin.mockResolvedValue(true);
    userFindUnique.mockResolvedValue({ orgId: "org_b" });
    const out = await metrics();
    expect(lastWindow(fetchRunSummary)).toMatchObject({ orgId: ORG, userId: ME });
    expect(out["scope"]["level"]).toBe("own");
  });

  it("an unknown agent suggests slugs and runs no query; a known one narrows window and link", async () => {
    const miss = await metrics({ agentSlug: "xyn" });
    expect(miss["error"]).toMatch(/No agent with slug "xyn"/);
    expect(miss["didYouMean"][0]).toBe("xyne");
    expect(analyticsCalls()).toBe(0);
    const out = await metrics({ agentSlug: "xyne", view: "tools", days: 30 });
    expect(lastWindow(fetchToolRollup).agentSlugs).toEqual(["xyne"]);
    expect(out["links"]["dashboard"]).toBe("https://claw.example/claw/v3/metrics?range=30&tab=tools&agent=xyne&sort=errors&dir=desc");
  });
});

describe("views", () => {
  it("tools: a 5,000-tool rollup still fits the output budget", async () => {
    fetchToolRollup.mockResolvedValue(rollup(Array.from({ length: 5_000 }, (_, i) => toolRow(`Some_Very_Long_Server_Name__tool_with_a_long_name_${i}`, { errors: 5_000 - i }))));
    const raw = await m.handleGetAgentMetrics({ view: "tools", limit: 500 }, ORG, ME);
    const out = parse(raw);
    expect(out["data"]["rows"].length).toBeGreaterThan(0);
    expect(out["data"]["rows"].length).toBeLessThanOrEqual(25);
    expect(Buffer.byteLength(raw)).toBeLessThan(m.OUTPUT_BUDGET_BYTES);
    expect(out["caveats"].join(" ")).toMatch(/of 5,000 tools/);
  });

  it("overview: envelope, previous window, worst tools, top agents and next calls", async () => {
    isClawAdmin.mockResolvedValue(true);
    fetchAgentLeaderboard.mockResolvedValue([
      { agentSlug: "xyne", orgId: ORG, runs: 300, failed: 10, successRate: 0.96, wall: pct(290), agent: { n: 1, avgLlmMs: null, avgToolMs: null }, tokens: { n: 1, promptPerRun: 1, outputPerRun: 1 }, toolCalls: 1_000, toolErrorRate: 0.02 },
    ]);
    const out = await metrics();
    expect(Object.keys(out)).toEqual(["view", "scope", "window", "coverage", "caveats", "data", "links", "next"]);
    expect(out["data"]["runs"]).toMatchObject({ n: 356, successRatePct: 95.5, previousWindow: { n: 4, successRatePct: null } });
    expect(out["data"]["worstTools"][0]).toMatchObject({ tool: "spaces-search", errors: 33, calls: 410 });
    expect(out["data"]["topAgents"][0]).toMatchObject({ agent: "xyne", runs: 300, successRatePct: 96 });
    expect(out["next"]).toContain('get_agent_metrics {"view":"tool_failures","tool":"spaces-search","days":7}');
  });

  it("tools: coverage carries denominators and low coverage is a caveat", async () => {
    fetchToolStatsCoverage.mockResolvedValue({ runsInWindow: 356, runsSummarised: 30, coverage: 30 / 356 });
    const low = await metrics({ view: "tools" });
    expect(low["coverage"]).toMatchObject({ runs: 356, withToolStats: 30 });
    expect(low["caveats"]).toContain("Tool figures cover 30 of 356 runs in this window; the rest have no tool stats yet (an admin can run the tool-stats backfill).");

  });

  it("tool_failures: org scope returns classes without raw samples", async () => {
    isClawAdmin.mockResolvedValue(true);
    fetchErrorClasses.mockResolvedValue({
      rows: [{ tool: "webfetch", errorClass: "http <n> from <url>", occurrences: 8, runs: 6, sample: "HTTP 429 from https://x.example/a", lastSeen: null, notFound: false }],
      total: 1, occurrences: 8,
    });
    const out = await metrics({ view: "tool_failures", tool: "webfetch" });
    expect(out["data"]["failures"]["rows"][0]).toEqual({ errorClass: "http <n> from <url>", occurrences: 8, runs: 6, lastSeen: null });
    expect(out["caveats"].join(" ")).toMatch(/Raw error samples are omitted at org scope/);
    expect(out["links"]["dashboard"]).toContain("tool=webfetch&dfilter=errors");
  });

  it("llm: low series coverage is a caveat and thin percentiles are withheld", async () => {
    fetchLlmCalls.mockResolvedValue({
      coverage: { runsInWindow: 356, runsWithSeries: 2, coverage: 2 / 356 },
      summary: { calls: 4, runs: 2, nTtft: 4, p50TtftMs: 700, p95TtftMs: 900, nDecode: 4, p50DecodeMs: 3_000, tokensPerSec: 205, avgContextTokens: 9_000, avgOutputTokens: 300, cacheHitRate: 0.5, compactions: 0, retries: 0, subagentCalls: 3, errorStops: 0 },
      byContext: [], byCallIndex: [], byModel: [],
    });
    const out = await metrics({ view: "llm" });
    expect(out["coverage"]).toEqual({ runs: 356, withLlmSeries: 2 });
    expect(out["caveats"]).toContain("Per-LLM-call data is based on 2 of 356 runs (0.6%).");
    expect(out["data"]["summary"]["firstTokenWait"]).toEqual({ n: 4, p50Ms: null, p95Ms: null, lowSample: true });
  });

  it("coverage: open-palette agents get a caveat, unused grants are grouped", async () => {
    fetchUnusedGrants.mockResolvedValue({
      agents: [
        { orgId: ORG, agentSlug: "xyne", state: "open-palette", openPalette: "all", observedTools: 40, granted: null, used: null, unused: null, usedShare: null },
        { orgId: ORG, agentSlug: "daily-brief", state: "scoped", observedTools: 3, granted: 8, used: 3, unused: 5, usedShare: 0.375 },
      ],
      unusedGrants: ["spaces-create-ticket", "spaces-search"].map((grant) => ({ orgId: ORG, agentSlug: "daily-brief", kind: "direct", grant, server: "xyne-spaces" })),
    });
    const out = await metrics({ view: "coverage" });
    expect(out["caveats"].join(" ")).toMatch(/1 agent\(s\) have an open palette \(xyne: all\)/);
    expect(out["data"]["agents"]).toMatchObject({ n: 2, usingEveryGrant: 0 });
    expect(out["data"]["unusedGrants"]).toEqual([{ agent: "daily-brief", server: "xyne-spaces", count: 2, grants: ["spaces-create-ticket", "spaces-search"] }]);
  });
});

describe("find_metric_sessions", () => {
  it("returns compact rows: no names or emails, text only for own or system runs", async () => {
    isClawAdmin.mockResolvedValue(true);
    fetchMetricSessions.mockResolvedValue(pageOf([
      sessionRow(0),
      sessionRow(1, { userId: "someone_else" }),
      sessionRow(2, { userId: "someone_else", triggerSource: "scheduled" }),
      sessionRow(3, { userId: "someone_else", restricted: true, task: null, sample: null }),
    ]));
    const raw = await m.handleFindMetricSessions({ kind: "tool_errored", tool: "webfetch", agentSlug: "xyne", days: 30 }, ORG, ME);
    expect(raw).not.toMatch(/me@example\.com|Me Person|someone_else|user_me/);
    const out = parse(raw);
    expect(out["sessions"][0]).toMatchObject({ sessionId: "sess_0", byYou: true, task: "summarise the release notes", errorSample: "HTTP 429 from upstream", tool: { calls: 3, errors: 2, recovered: 1 }, durationS: 20 });
    expect(out["sessions"][1]).toMatchObject({ byYou: false });
    expect(out["sessions"][1]).not.toHaveProperty("task");
    expect(out["sessions"][2]).toHaveProperty("task");
    expect(out["sessions"][3]).toMatchObject({ restricted: true });
    expect(out["caveats"].join(" ")).toMatch(/text withheld for 1 session/);
    expect(out["links"]["dashboard"]).toBe("https://claw.example/claw/v3/metrics?range=30&tab=tools&agent=xyne&dfilter=errors&tool=webfetch");
  });

  it("trims a long page to the budget and re-keys the cursor on the last row kept", async () => {
    const long = "word ".repeat(400);
    const rows = Array.from({ length: 25 }, (_, i) => sessionRow(i, { task: long, sample: long }));
    fetchMetricSessions.mockResolvedValue(pageOf(rows, { page: { limit: 25, nextCursor: "lib-cursor", hasMore: true } }));
    const raw = await m.handleFindMetricSessions({ kind: "tool_errored", tool: "webfetch", limit: 25 }, ORG, ME);
    const out = parse(raw);
    const kept = out["sessions"].length;
    expect(Buffer.byteLength(raw)).toBeLessThan(m.OUTPUT_BUDGET_BYTES);
    expect(kept).toBeLessThan(25);
    expect(out["sessions"][0]["task"].length).toBeLessThanOrEqual(120);
    expect(decodeCursor(out["page"]["cursor"], "completedAt")).toEqual({ w: "completedAt", k: Date.parse(rows[kept - 1]!.completedAt!), id: `run_${kept - 1}` });
    expect(out["next"]).toContain(out["page"]["cursor"]);
  });

});

describe("registry vs dispatcher", () => {
  it("every introspect tool has a dispatcher case; an unknown name is rejected", async () => {
    for (const t of AGENT_INTROSPECT_TOOLS) {
      const out = await handleAgentIntrospect(t.name, {}, undefined, undefined);
      expect(() => JSON.parse(out)).not.toThrow();
    }
    await expect(handleAgentIntrospect("not_a_tool", {}, ORG, ME)).rejects.toThrow(/Unknown agent-introspect tool/);
  });

  it("the metrics tools are listed read-only", () => {
    expect(AGENT_INTROSPECT_TOOLS.map((t) => t.name)).toEqual(expect.arrayContaining(["get_agent_metrics", "find_metric_sessions"]));
    expect(AGENT_INTROSPECT_TOOLS.every((t) => t.readOnly === true && t.selectionKey === t.name)).toBe(true);
  });
});
