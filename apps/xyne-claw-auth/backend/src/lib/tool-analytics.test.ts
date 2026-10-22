import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import {
  CLF_CAPTURE_RE, CLF_TOKEN_RE, NOT_DROPPED_END, RESULT_TEXT, TOOL_SORT_KEYS, fetchCitations, isDataWriteError, pageToolRows,
  rankTools, toolRollupSql, uncitedCount, toolCiteRatesSql, type ToolRow,
} from "./tool-analytics.js";
import { HISTOGRAM_SLOTS } from "./tool-stats.js";
import { llmCallsSql, llmCoverageSql, llmRunsSql, shapeLlmCalls } from "./llm-call-analytics.js";
import { statsWindowPredicate, windowPredicate, type AnalyticsWindow } from "./metrics-core.js";
import { clawMetricsFields } from "../repositories/agentRunRepository.js";

const sqlText = (fragment: Prisma.Sql): string => fragment.text;
const SENTINEL_RESULT = "(no result — tool end event was not received)";

const baseWindow: AnalyticsWindow = {
  windowStart: new Date("2026-08-01T00:00:00.000Z"), windowEnd: new Date("2026-08-08T00:00:00.000Z"), windowColumn: "completedAt",
  userFilter: Prisma.empty, orgFilter: Prisma.empty, allOrgs: false,
};

describe("NOT_DROPPED_END", () => {
  it("excludes both dropped-end shapes with a wildcard sentinel, treats a missing status as finished, never keys on durationMs", () => {
    const text = sqlText(NOT_DROPPED_END);
    expect(text).toContain("COALESCE(v->>'status', '') <> 'running'");
    expect(text).toContain("NOT LIKE '(no result%tool end event was not received)'");
    expect(text).not.toMatch(/—|durationMs/);
    expect(SENTINEL_RESULT).toMatch(/^\(no result.*tool end event was not received\)$/);
    expect(sqlText(RESULT_TEXT)).toBe("COALESCE(v->>'result', '')");
  });
});

describe("citation token patterns", () => {
  const answer = "Revenue rose [clf-call_abc123#2] and churn fell [clf-call_xyz789#11].";

  it("detects tokens, rejects one missing its chunk index, and captures every distinct toolCallId", () => {
    expect([answer, "[clf-call_abc123]"].map((t) => new RegExp(CLF_TOKEN_RE).test(t))).toEqual([true, false]);
    expect([...answer.matchAll(new RegExp(CLF_CAPTURE_RE, "g"))].map((m) => m[1])).toEqual(["call_abc123", "call_xyz789"]);
  });
});

describe("windowPredicate", () => {
  it("binds bounds, switches the window column and adds the agent filter only when scoped", () => {
    const { text, values } = windowPredicate(baseWindow);
    expect(text).toContain('r."completedAt" >= $1');
    expect(values).toEqual(expect.arrayContaining([baseWindow.windowStart, baseWindow.windowEnd]));
    expect(sqlText(windowPredicate({ ...baseWindow, windowColumn: "startedAt" }))).toContain('r."startedAt"');
    expect(text).not.toContain('r."agentSlug"');
    expect(windowPredicate({ ...baseWindow, agentSlugs: ["euler"] }).text).toContain('r."agentSlug" =');
    const many = windowPredicate({ ...baseWindow, agentSlugs: ["euler", "gauss"] });
    expect(many.text).toContain('r."agentSlug" IN (');
  });
});

describe("toolRollupSql (one pass over agent_run_tool_stats)", () => {
  const text = sqlText(toolRollupSql(baseWindow));
  it("is one GROUP BY over the tool rows, sums every bucket inline and windows on the tool row's completedAt", () => {
    expect(text).not.toMatch(/\bWITH\b|MATERIALIZED|jsonb_array_elements|"agent_runs"|'interrupted \(orphaned run\)'/);
    expect(text).toContain('FROM "agent_run_tool_stats" t');
    for (let i = 0; i < HISTOGRAM_SLOTS; i++) expect(text).toContain(`sum(t."durationBuckets"[${i + 1}]) AS h${i}`);
    for (const col of ["s_err", "s_rec", "s_unrec", "s_drop", "s_dup", "s_empty", "s_cited"]) expect(text).toContain(col);
    expect(text).toContain(sqlText(statsWindowPredicate(baseWindow, "t")));
  });

  it("takes cite-rate denominators from the tool rows and reads blobs only for cited conversations", () => {
    const rates = sqlText(toolCiteRatesSql(baseWindow));
    expect(rates).toContain('sum(t."calls" - t."dropped")');
    expect(rates).toContain('JOIN "agent_run_stats" s ON s."runId" = r."id"');
  });
});

const row = (tool: string, over: Partial<ToolRow> = {}): ToolRow => ({
  tool, calls: 10, runs: 5, topLevelCalls: 10, childCalls: 0, errors: 0, errorRate: 0, notFound: 0, dropped: 0, droppedRate: 0,
  empty: 0, emptyRate: 0, duplicates: 0, duplicateRate: 0, recovered: 0, recoveryRate: null, unrecovered: 0, citeable: 0, cited: 0,
  citeRate: null, timedCalls: 10, avgMs: 100, p50Ms: 80, p95Ms: 200, p95Overflow: false, maxMs: 300, totalMs: 1000, bytes: 1000,
  avgBytes: 100, contextShare: 0.1,
  sessions: { errored: 0, recovered: 0, unrecovered: 0, dropped: 0, duplicated: 0, empty: 0, cited: 0 },
  ...over,
});

describe("pageToolRows", () => {
  const rows = [
    row("alpha", { errors: 3, errorRate: 0.3, recoveryRate: 0.5 }),
    row("beta", { errors: 1, errorRate: 0.1, recoveryRate: null }),
    row("gamma", { errors: 3, errorRate: 0.3, recoveryRate: 1, p95Ms: null, p95Overflow: true }),
  ];
  const tools = (req: Partial<Parameters<typeof pageToolRows>[1]>) =>
    pageToolRows(rows, { sort: "calls", dir: "desc", limit: 10, offset: 0, ...req }).rows.map((r) => r.tool);

  it("sorts with a stable tool-name tie-break, nulls last both ways, overflow p95 as largest", () => {
    expect(tools({ sort: "errors" })).toEqual(["alpha", "gamma", "beta"]);
    for (const dir of ["asc", "desc"] as const) expect(tools({ sort: "recoveryRate", dir }).at(-1)).toBe("beta");
    expect(tools({ sort: "p95Ms", limit: 1 })).toEqual(["gamma"]);
  });

  it("sorts by duplicate count and by uncited citeable results, both directions", () => {
    const q = [
      row("few-dups", { duplicates: 1, duplicateRate: 0.5, citeable: 2, cited: 0 }),
      row("many-dups", { duplicates: 40, duplicateRate: 0.1, citeable: 100, cited: 90 }),
      row("most-uncited", { duplicates: 3, duplicateRate: 0.01, citeable: 60, cited: 5 }),
    ];
    const order = (sort: "duplicates" | "uncited", dir: "asc" | "desc") => pageToolRows(q, { sort, dir, limit: 10, offset: 0 }).rows.map((r) => r.tool);
    expect(order("uncited", "desc")).toEqual(["most-uncited", "many-dups", "few-dups"]);
    expect(uncitedCount({ citeable: 3, cited: 5 })).toBe(0);
    expect(TOOL_SORT_KEYS).toEqual(expect.arrayContaining(["duplicates", "uncited", "duplicateRate", "citeRate"]));
  });

  it("reports the match count across the window, not the page length", () => {
    const page = pageToolRows(rows, { sort: "calls", dir: "desc", limit: 1, offset: 1, search: "A" });
    expect([page.total, page.rows.length]).toEqual([3, 1]);
  });
});

describe("rankTools", () => {
  it("keeps the rest of the window in `other` and gates averages on call count", () => {
    const rows = Array.from({ length: 10 }, (_, i) => row(`t${i}`, { totalMs: 1000 * (i + 1), calls: i < 2 ? 2 : 10, timedCalls: i < 2 ? 2 : 10 }));
    const { time } = rankTools(rows);
    expect([time.byTotal.length, time.byTotal[0]?.tool, time.other.tools, time.other.value]).toEqual([8, "t9", 2, 3000]);
    expect(time.byAvg.every((p) => p.calls >= 5)).toBe(true);
    expect(rankTools([]).errors.other.share).toBeNull();
  });
});

describe("isDataWriteError", () => {
  it("treats only errors in the row's own data (SQLSTATE class 22 or 23) as permanent", () => {
    const unmapped = (code: string) => new Error(`ConnectorError { kind: QueryError(PostgresError { code: "${code}", message: "x" }) }`);
    for (const e of [{ code: "P2003" }, { code: "P2002" }, unmapped("22P05"), unmapped("22021")]) expect(isDataWriteError(e)).toBe(true);
    for (const e of [unmapped("57014"), { code: "P2024" }, { code: "P2028" }, new Error("Connection reset"), null]) expect(isDataWriteError(e)).toBe(false);
  });
});

describe("fetchCitations exact gate", () => {
  it("refuses exact for a workspace-wide window over 7 days", async () => {
    await expect(fetchCitations({ ...baseWindow, windowStart: new Date("2026-07-09T00:00:00.000Z") }, { exact: true })).rejects.toMatchObject({ status: 400 });
  });
});

describe("llm-call analytics", () => {
  it("unnests the series once, with grouping sets, exact percentiles and no jsonb_typeof guard", () => {
    const text = sqlText(llmCallsSql(baseWindow, false));
    expect(text.match(/jsonb_array_elements/g)).toHaveLength(1);
    expect(text).toContain("GROUP BY GROUPING SETS ((in_scope), (in_scope, model, provider), (in_scope, ctx_b), (in_scope, idx_b))");
    expect(text).toContain("percentile_cont(0.95)");
    expect(text).toContain("(c->>'sa' IS NULL)");
    expect(sqlText(llmCallsSql(baseWindow, true))).not.toContain("(c->>'sa' IS NULL)");
  });

  it("reports weighted throughput and the n behind every figure", () => {
    const set = (over: Record<string, unknown>) => ({
      set_id: 15, in_scope: true, model: null, provider: null, ctx_b: null, idx_b: null, calls: 4n, n_ttft: 4n, n_decode: 4n, p50_ttft: 1312.5,
      p95_ttft: 12537, p50_decode: 492.5, tps_out: 459, tps_decode_ms: 2240, avg_ctx: 28683, avg_out: 114.75, cache_read: 645, ctx_total: 1000,
      compactions: 0n, retries: 0n, subagent_calls: 0n, error_stops: 0n, ...over,
    });
    const res = shapeLlmCalls(
      [set({}), set({ in_scope: false, calls: 3n, subagent_calls: 3n, p50_ttft: null, p95_ttft: null, p50_decode: null }), set({ set_id: 3, model: "m1", provider: "p1" })] as never,
      [{ set_id: 3, in_scope: true, model: null, provider: null, runs_model: 2n, runs_scope: 1n }, { set_id: 0, in_scope: true, model: "m1", provider: "p1", runs_model: 1n, runs_scope: 1n }] as never,
      { runs_in_window: 356, runs_with_series: 2, series_since: new Date("2026-08-03T10:00:00.000Z") },
    );
    expect(res.summary).toMatchObject({ calls: 4, runs: 1, nTtft: 4, nDecode: 4, p50TtftMs: 1313, tokensPerSec: 205, subagentCalls: 3, cacheHitRate: 0.645 });
    expect(res.coverage).toEqual({ runsInWindow: 356, runsWithSeries: 2, coverage: 2 / 356, seriesSince: "2026-08-03T10:00:00.000Z" });
  });

  it("returns null, not zero, for figures without a sample", () => {
    const res = shapeLlmCalls([], [], { runs_in_window: 0, runs_with_series: 0, series_since: null });
    expect([res.summary.tokensPerSec, res.summary.cacheHitRate, res.coverage.coverage]).toEqual([null, null, null]);
  });

  it("takes coverage from the covering indexes and unnests only stats rows that carry a series", () => {
    const cov = sqlText(llmCoverageSql(baseWindow));
    expect(cov).toContain(`count(s."llmCallCount")`);
    expect(cov).not.toContain("jsonb_array_elements");
    for (const q of [llmCallsSql(baseWindow, false), llmRunsSql(baseWindow, false)]) {
      expect(sqlText(q)).toContain(`s."llmCallCount" IS NOT NULL`);
    }
  });
});

describe("clawMetricsFields", () => {
  it("forwards every metrics field a claw callback carried, llmCalls included", () => {
    const body = {
      sessionId: "s-1", status: "completed", result: "hi", toolInvocations: [{ toolName: "search" }],
      tokenUsage: { input: 10, output: 20 }, latency: { totalMs: 1200, llmTurns: 3 },
      citationReflection: { outcome: "already_cited" }, llmCalls: [{ i: 1, ttft: 400 }],
    };
    const { sessionId, status, result, ...metrics } = body;
    expect(clawMetricsFields(body)).toEqual(metrics);
  });

  it("omits absent or undefined keys, but keeps an explicitly empty invocation list", () => {
    expect(clawMetricsFields({ sessionId: "s-1", tokenUsage: undefined })).toEqual({});
    expect(clawMetricsFields({ toolInvocations: [] })).toEqual({ toolInvocations: [] });
  });
});
