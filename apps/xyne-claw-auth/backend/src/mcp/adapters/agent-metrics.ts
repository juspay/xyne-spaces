/**
 * get_agent_metrics / find_metric_sessions: agent-facing face of the v3 Metrics page, run in-process
 * by /mcp/call so the verified run identity (contextOrgId, requestingUserId) scopes every read.
 * Figures come from the same libraries and cache entries as the dashboard.
 *
 * Output rules: every figure carries its n; a rate over nothing is null; percentiles below the
 * sample floors are null with `lowSample`; `caveats[]` is generated from the data; the JSON stays
 * under OUTPUT_BUDGET_BYTES so claw does not spill it to a file.
 *
 * ACL: buildScopedWindow is the single scope rule (org-wide only for a CLAW_ADMIN of contextOrgId,
 * else own runs). Session text follows the stricter agent rule (strictText).
 */

import { AGENT_INTROSPECT_TOOL_DEFS } from "xyne-claw-shared";
import { prisma } from "../../db.js";
import { CONFIG } from "../../config.js";
import { createLogger } from "../../logger.js";
import {
  METRIC_TTL,
  SAMPLE_FLOORS,
  buildScopedWindow,
  cachedMetric,
  snapDays,
  type AnalyticsWindow,
  type MetricsDays,
  type MetricsScope,
} from "../../lib/metrics-core.js";
import { fetchAgentLeaderboard, fetchRunSummary, type AgentLeaderRow, type PctBlock, type SummaryFigures } from "../../lib/run-analytics.js";
import {
  MetricsBadRequestError,
  fetchErrorClasses,
  fetchToolRollup,
  fetchToolStatsCoverage,
  fetchUnusedGrants,
  pageToolRows,
  type ErrorClassRow,
  type ToolRollup,
  type ToolRow,
  type ToolSortKey,
} from "../../lib/tool-analytics.js";
import { fetchLlmCalls, type LlmCallsResult } from "../../lib/llm-call-analytics.js";
import { encodeCursor, fetchMetricSessions, type MetricSessionRow, type MetricSessionsResult, type ToolSignal } from "../../lib/metric-sessions.js";
import { DURATION_BUCKETS_MS } from "../../lib/tool-stats.js";
import { userIdAliasesFor } from "../../lib/users-jit.js";

const log = createLogger("agent-metrics");

/** Enums come from the shared tool defs so the model-facing schema and validation cannot drift. */
function schemaEnum(slug: string, prop: string): readonly string[] {
  const def = AGENT_INTROSPECT_TOOL_DEFS.find((d) => d.slug === slug);
  const p = (def?.inputSchema as { properties?: Record<string, { enum?: unknown[] }> } | undefined)?.properties?.[prop];
  return (p?.enum ?? []).map(String);
}

export type MetricsView = "overview" | "tools" | "tool_failures" | "llm" | "coverage";
export type SessionsKind = "tool_errored" | "tool_recovered" | "tool_dropped" | "tool_called" | "run_failed" | "run_slow";
type SortBy = "errors" | "errorRate" | "calls" | "p95" | "recoveryRate" | "contextBytes";

const VIEWS = schemaEnum("get_agent_metrics", "view") as readonly MetricsView[];
const SORTS = schemaEnum("get_agent_metrics", "sortBy") as readonly SortBy[];
const KINDS = schemaEnum("find_metric_sessions", "kind") as readonly SessionsKind[];

const DEFAULT_LIMIT = 8;
const DEFAULT_OVERVIEW_TOOLS = 5;
const DEFAULT_SESSIONS = 10;
export const MAX_ROWS = 25;
/** Below claw's promote-to-file threshold. */
export const OUTPUT_BUDGET_BYTES = 6_000;
const MAX_TOOL_NAME = 200;
const MAX_CURSOR = 512;
const CLASS_CHARS = 160;
const SAMPLE_CHARS = 160;
const TASK_CHARS = 120;
const LOW_COVERAGE = 0.9;
/** Matches the dashboard leaderboard so both read one cache entry. */
const LEADERBOARD_LIMIT = 20;
const TOP_AGENTS_SHOWN = 5;

/** Cache endpoint names shared with routes/metrics*.ts. */
const KEY = {
  summary: "summary",
  agentsTop: "agents/top",
  toolRollup: "tools/rollup",
  toolCoverage: "tools/coverage",
  errorClasses: "tools/error-classes",
  unusedGrants: "tools/unused-grants",
  llmCalls: "llm-calls",
} as const;

const SORT_KEY: Record<SortBy, ToolSortKey> = {
  errors: "errors",
  errorRate: "errorRate",
  calls: "calls",
  p95: "p95Ms",
  recoveryRate: "recoveryRate",
  contextBytes: "bytes",
};

/** Which floor gates a rate sort: a 1-of-1 error rate must not top a ranking. */
const RATE_SORT_FLOOR: Partial<Record<SortBy, (r: ToolRow) => boolean>> = {
  errorRate: (r) => r.calls >= SAMPLE_FLOORS.toolRateRow,
  recoveryRate: (r) => r.errors >= SAMPLE_FLOORS.recovery,
  p95: (r) => r.timedCalls >= SAMPLE_FLOORS.p95,
};

const KIND_TO_REQUEST: Record<SessionsKind, { kind: "tool" | "failed" | "slow"; signal?: ToolSignal }> = {
  tool_errored: { kind: "tool", signal: "errors" },
  tool_recovered: { kind: "tool", signal: "recovered" },
  tool_dropped: { kind: "tool", signal: "dropped" },
  tool_called: { kind: "tool", signal: "calls" },
  run_failed: { kind: "failed" },
  run_slow: { kind: "slow" },
};

/** Dashboard drawer state for each kind (MetricsPrimitives DRILL_PARAMS). */
const KIND_TO_DRILL: Record<SessionsKind, Record<string, string>> = {
  tool_errored: { tab: "tools", dfilter: "errors" },
  tool_recovered: { tab: "tools", dfilter: "recovered" },
  tool_dropped: { tab: "tools", dfilter: "dropped" },
  tool_called: { tab: "tools", dfilter: "calls" },
  run_failed: { tab: "overview", drill: "failed" },
  run_slow: { tab: "overview", drill: "slow" },
};

const VIEW_TO_TAB: Record<MetricsView, string> = {
  overview: "overview",
  tools: "tools",
  tool_failures: "tools",
  llm: "llm",
  coverage: "coverage",
};

const SYSTEM_TRIGGERS = new Set(["scheduled", "automation"]);

export function clampLimit(raw: unknown, fallback: number): number {
  const n = Number(raw);
  if (raw === undefined || raw === null || raw === "" || !Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), 1), MAX_ROWS);
}

const round1 = (v: number): number => Math.round(v * 10) / 10;
/** A percentage with one decimal; null when there is nothing to divide by. */
export const pct1 = (num: number, den: number): number | null => (den > 0 ? round1((num / den) * 100) : null);
const ratioPct = (r: number | null): number | null => (r === null ? null : round1(r * 100));
const secs = (ms: number | null): number | null => (ms === null ? null : round1(ms / 1000));
const cut = (s: string | null | undefined, n: number): string | null => {
  if (s == null) return null;
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > n ? `${flat.slice(0, n - 1)}…` : flat;
};
const fmt = (n: number): string => n.toLocaleString("en-US");

/** Percentiles with the sample floors applied; `lowSample` marks anything withheld. */
export function percentiles(block: PctBlock, unit: "s" | "ms"): Record<string, number | boolean | null> {
  const p50 = block.n >= SAMPLE_FLOORS.p50 ? block.p50Ms : null;
  const p95 = block.n >= SAMPLE_FLOORS.p95 ? block.p95Ms : null;
  const out: Record<string, number | boolean | null> = unit === "s"
    ? { n: block.n, p50S: secs(p50), p95S: secs(p95) }
    : { n: block.n, p50Ms: p50, p95Ms: p95 };
  if (block.n < SAMPLE_FLOORS.p95) out["lowSample"] = true;
  return out;
}

/** Averages are withheld below SAMPLE_FLOORS.avg: models quote them even beside a lowSample flag. */
const avgOk = (n: number): boolean => n >= SAMPLE_FLOORS.avg;

function share(part: number, whole: number): string {
  const p = pct1(part, whole);
  return `${fmt(part)} of ${fmt(whole)} runs${p === null ? "" : ` (${p}%)`}`;
}

/** Caveats for every capture ratio under LOW_COVERAGE (skipped when the window is empty). */
export function coverageCaveats(
  items: Array<{ label: string; part: number; whole: number; withheld?: boolean; floor?: number }>,
): string[] {
  const out: string[] = [];
  for (const it of items) {
    if (it.whole <= 0) continue;
    if (it.part / it.whole >= LOW_COVERAGE) continue;
    const withheld = it.withheld ? `; percentiles withheld (needs >= ${it.floor ?? SAMPLE_FLOORS.p95})` : "";
    out.push(`${it.label} is based on ${share(it.part, it.whole)}${withheld}.`);
  }
  return out;
}

function distance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length]!;
}

/** Closest names first; substring matches beat edit distance. */
export function closest(needle: string, candidates: string[], n = 5): string[] {
  const q = needle.toLowerCase();
  return [...new Set(candidates)]
    .map((c) => {
      const l = c.toLowerCase();
      const score = l.includes(q) || q.includes(l) ? 0 : distance(q, l);
      return { c, score };
    })
    .sort((a, b) => a.score - b.score || a.c.localeCompare(b.c))
    .slice(0, n)
    .map((x) => x.c);
}

/** Pops rows from the tail of the longest list until the envelope fits the budget, adding a caveat. Mutates the lists in place. */
export function fitBudget(envelope: { caveats: string[] }, lists: unknown[][], budget = OUTPUT_BUDGET_BYTES): number {
  const size = () => Buffer.byteLength(JSON.stringify(envelope), "utf8");
  const target = budget - 160;
  let trimmed = 0;
  while (size() > target) {
    const victim = lists
      .filter((l) => l.length > 1)
      .sort((a, b) => JSON.stringify(b).length - JSON.stringify(a).length)[0];
    if (!victim) break;
    victim.pop();
    trimmed++;
  }
  if (trimmed > 0) {
    envelope.caveats.push(`Output trimmed by ${trimmed} row(s) to stay under ${fmt(budget)} bytes; ask for a smaller limit, one agent or one tool.`);
  }
  while (size() > budget && envelope.caveats.length > 1) envelope.caveats.splice(envelope.caveats.length - 2, 1);
  return trimmed;
}

function dashboardLink(days: MetricsDays, tab: string, agentSlug: string | null, extra: Record<string, string> = {}): string {
  const q = new URLSearchParams({ range: String(days), tab });
  if (agentSlug) q.set("agent", agentSlug);
  for (const [k, v] of Object.entries(extra)) q.set(k, v);
  return `${CONFIG.frontendUrl}v3/metrics?${q.toString()}`;
}

/** A copyable follow-up call so the model never guesses parameter names. */
function call(name: string, args: Record<string, unknown>): string {
  const clean = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined && v !== null));
  return `${name} ${JSON.stringify(clean)}`;
}

interface Ctx {
  window: AnalyticsWindow;
  scope: MetricsScope;
  days: MetricsDays;
  agentSlug: string | null;
}

function scopeBlock(ctx: Ctx): Record<string, unknown> {
  return {
    level: ctx.scope.level,
    agentSlug: ctx.agentSlug,
    note: ctx.scope.level === "org" ? "all users' runs in your organization" : "your own runs only",
  };
}

function windowBlock(ctx: Ctx): Record<string, unknown> {
  return {
    days: ctx.days,
    from: ctx.window.windowStart.toISOString(),
    to: ctx.window.windowEnd.toISOString(),
    basis: "runs finished in the window (completedAt)",
  };
}

function scopeCaveats(ctx: Ctx): string[] {
  return ctx.scope.level === "own"
    ? ["Scope is your own runs only; org-wide figures need a claw admin of this organization."]
    : [];
}

const errorJson = (error: string, extra: Record<string, unknown> = {}): string => JSON.stringify({ error, ...extra });

function isTimeout(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /statement timeout|canceling statement|57014/i.test(msg);
}

function failure(tool: string, err: unknown): string {
  if (err instanceof MetricsBadRequestError) return errorJson(err.message);
  if (isTimeout(err)) return errorJson("metrics query timed out; try days=1 or an agentSlug");
  log.warn(`[agent-metrics] ${tool} failed: ${err instanceof Error ? err.message : String(err)}`);
  return errorJson("metrics are temporarily unavailable");
}

function refused(tool: string, ctx: { error: string; extra?: Record<string, unknown> }): string {
  log.warn(`[agent-metrics] ${tool} refused: ${ctx.error}`);
  return errorJson(ctx.error, ctx.extra);
}

/** Identity, agent, then scope, so a refusal or unknown agent issues no analytics query. */
async function resolveContext(
  params: Record<string, unknown>,
  contextOrgId: string | undefined,
  requestingUserId: string | undefined,
): Promise<Ctx | { error: string; extra?: Record<string, unknown> }> {
  if (!contextOrgId) return { error: "metrics are unavailable: this run has no organisation context" };
  if (!requestingUserId) return { error: "metrics are unavailable: this run has no requesting user" };
  const days = snapDays(params["days"]);
  const rawSlug = typeof params["agentSlug"] === "string" ? params["agentSlug"].trim() : "";
  let agentSlug: string | null = null;
  if (rawSlug) {
    const agent = await prisma.agent.findUnique({
      where: { orgId_slug: { orgId: contextOrgId, slug: rawSlug } },
      select: { slug: true },
    });
    if (!agent) {
      const roster = await prisma.agent.findMany({ where: { orgId: contextOrgId }, select: { slug: true }, take: 1000 });
      return {
        error: `No agent with slug "${rawSlug.slice(0, 100)}" in this organization`,
        extra: { didYouMean: closest(rawSlug, roster.map((a) => a.slug)) },
      };
    }
    agentSlug = agent.slug;
  }
  const scoped = await buildScopedWindow({
    contextOrgId,
    requesterId: requestingUserId,
    days,
    ...(agentSlug ? { agentSlugs: [agentSlug] } : {}),
  });
  if ("error" in scoped) return { error: scoped.error };
  return { window: scoped.window, scope: scoped.scope, days, agentSlug };
}

const summaryBlock = (w: AnalyticsWindow) =>
  cachedMetric({ endpoint: KEY.summary, window: w }, METRIC_TTL.current, () => fetchRunSummary(w));
const leaderboardBlock = (w: AnalyticsWindow) =>
  cachedMetric({ endpoint: KEY.agentsTop, window: w, params: { limit: LEADERBOARD_LIMIT } }, METRIC_TTL.current, () =>
    fetchAgentLeaderboard(w, LEADERBOARD_LIMIT));
const rollupBlock = (w: AnalyticsWindow) =>
  cachedMetric({ endpoint: KEY.toolRollup, window: w }, METRIC_TTL.current, () => fetchToolRollup(w));
const toolCoverageBlock = (w: AnalyticsWindow) =>
  cachedMetric({ endpoint: KEY.toolCoverage, window: w }, METRIC_TTL.current, () => fetchToolStatsCoverage(w));
const errorClassesBlock = (w: AnalyticsWindow, tool: string, limit: number) =>
  cachedMetric({ endpoint: KEY.errorClasses, window: w, params: { tool, limit, offset: 0, perTool: null } }, METRIC_TTL.current, () =>
    fetchErrorClasses(w, { tool, limit, offset: 0 }));
const unusedGrantsBlock = (w: AnalyticsWindow) =>
  cachedMetric({ endpoint: KEY.unusedGrants, window: w }, METRIC_TTL.current, () => fetchUnusedGrants(w));
const llmBlock = (w: AnalyticsWindow, includeSubagents: boolean) =>
  cachedMetric({ endpoint: KEY.llmCalls, window: w, params: { includeSubagents } }, METRIC_TTL.current, () =>
    fetchLlmCalls(w, { includeSubagents }));

const LAST_EDGE_MS = Math.max(...DURATION_BUCKETS_MS);
const BUCKET_CAVEAT =
  `Tool p95Ms is estimated from duration buckets (interpolated within a bucket such as 2500-5000 ms), not exact; p95Over means above ${LAST_EDGE_MS / 1000} s.`;

/** One compact tool row; the n behind each rate is beside it. */
export function shapeToolRow(r: ToolRow): Record<string, unknown> {
  const p95 = r.timedCalls >= SAMPLE_FLOORS.p95 && !r.p95Overflow ? r.p95Ms : null;
  const row: Record<string, unknown> = {
    tool: r.tool,
    calls: r.calls,
    runs: r.runs,
    errors: r.errors,
    errorRatePct: ratioPct(r.errorRate),
    recovered: r.recovered,
    recoveredPct: ratioPct(r.recoveryRate),
    timed: r.timedCalls,
    avgMs: r.timedCalls > 0 ? r.avgMs : null,
    p95Ms: p95,
  };
  if (r.p95Overflow && r.timedCalls >= SAMPLE_FLOORS.p95) row["p95Over"] = LAST_EDGE_MS;
  if (r.dropped > 0) row["dropped"] = r.dropped;
  if (r.notFound > 0) row["notFound"] = r.notFound;
  if (r.avgBytes !== null) row["avgBytes"] = Math.round(r.avgBytes);
  if (r.calls < SAMPLE_FLOORS.toolRateRow || r.timedCalls < SAMPLE_FLOORS.p95) row["lowSample"] = true;
  return row;
}

/** Ranked rows; rows under a rate sort's floor go after the ones that clear it. */
export function rankToolRows(rows: ToolRow[], sortBy: SortBy, limit: number): { rows: ToolRow[]; total: number } {
  const sorted = pageToolRows(rows, { sort: SORT_KEY[sortBy], dir: "desc", limit: rows.length, offset: 0 }).rows;
  const floor = RATE_SORT_FLOOR[sortBy];
  const ordered = floor ? [...sorted.filter(floor), ...sorted.filter((r) => !floor(r))] : sorted;
  return { rows: ordered.slice(0, limit), total: rows.length };
}

function toolCoverageCaveats(cov: { runsInWindow: number; runsSummarised: number }): string[] {
  if (cov.runsInWindow <= 0 || cov.runsSummarised / cov.runsInWindow >= LOW_COVERAGE) return [];
  return [
    `Tool figures cover ${fmt(cov.runsSummarised)} of ${fmt(cov.runsInWindow)} runs in this window; ` +
      "the rest have no tool stats yet (an admin can run the tool-stats backfill).",
  ];
}

function runsBlock(cur: SummaryFigures, prev: SummaryFigures | null): Record<string, unknown> {
  const out: Record<string, unknown> = {
    n: cur.runs,
    completed: cur.completed,
    failed: cur.failed,
    cancelled: cur.cancelled,
    successRatePct: ratioPct(cur.successRate),
  };
  if (cur.delegatedRuns > 0) out["delegated"] = cur.delegatedRuns;
  if (cur.runs < SAMPLE_FLOORS.rate) out["lowSample"] = true;
  out["previousWindow"] = prev
    ? {
        n: prev.runs,
        successRatePct: prev.runs >= SAMPLE_FLOORS.rate ? ratioPct(prev.successRate) : null,
        endToEndP95S: prev.wall.n >= SAMPLE_FLOORS.p95 ? secs(prev.wall.p95Ms) : null,
      }
    : null;
  return out;
}

/** The overview envelope's data + coverage + caveats from already-fetched figures. */
export function buildOverview(input: {
  current: SummaryFigures;
  previous: SummaryFigures | null;
  rollup: ToolRollup | null;
  leaders: AgentLeaderRow[] | null;
  toolLimit: number;
  days?: number;
}): { data: Record<string, unknown>; coverage: Record<string, number>; caveats: string[]; worstTool: string | null } {
  const c = input.current;
  const coverage = {
    runs: c.runs,
    withAgentTiming: c.agent.n,
    withReplyStart: c.replyStart.n,
    withTokens: c.tokens.n,
    withToolStats: c.tools.runsSummarised,
    withLlmSeries: c.llm.runsWithSeries,
  };
  const caveats: string[] = [];
  if (c.runs === 0) {
    caveats.push((input.days ?? 7) < 30
      ? "No runs finished in this window for this scope; try days=30."
      : "No runs finished in this window for this scope.");
  }
  caveats.push(...coverageCaveats([
    { label: "Agent time (claw-measured)", part: c.agent.n, whole: c.runs, withheld: c.agent.n < SAMPLE_FLOORS.p95 },
    { label: "Reply-start latency", part: c.replyStart.n, whole: c.runs, withheld: c.replyStart.n < SAMPLE_FLOORS.p95 },
    { label: "Token usage", part: c.tokens.n, whole: c.runs },
    { label: "Per-LLM-call data (view=llm)", part: c.llm.runsWithSeries, whole: c.runs },
  ]));
  caveats.push(...toolCoverageCaveats({ runsInWindow: c.runs, runsSummarised: c.tools.runsSummarised }));

  const worst = (input.rollup?.rows ?? [])
    .filter((r) => r.errors > 0)
    .sort((a, b) => b.errors - a.errors || a.tool.localeCompare(b.tool))
    .slice(0, input.toolLimit);
  if (worst.some((r) => r.timedCalls >= SAMPLE_FLOORS.p95)) caveats.push(BUCKET_CAVEAT);

  const data: Record<string, unknown> = {
    runs: runsBlock(c, input.previous),
    endToEnd: percentiles(c.wall, "s"),
    agentTime: {
      ...percentiles(c.agent, "s"),
      avgLlmS: avgOk(c.agent.n) ? secs(c.agent.avgLlmMs) : null,
      avgToolS: avgOk(c.agent.n) ? secs(c.agent.avgToolMs) : null,
    },
    replyStart: percentiles(c.replyStart, "ms"),
    tokens: {
      n: c.tokens.n,
      promptPerRun: avgOk(c.tokens.n) ? c.tokens.promptPerRun : null,
      outputPerRun: avgOk(c.tokens.n) ? c.tokens.outputPerRun : null,
      cacheHitPct: avgOk(c.tokens.n) ? ratioPct(c.tokens.cacheHitRate) : null,
      ...(avgOk(c.tokens.n) ? {} : { lowSample: true }),
    },
    throughput: {
      n: c.throughput.n,
      tokensPerSec: avgOk(c.throughput.n) ? c.throughput.tokensPerSec : null,
      ...(avgOk(c.throughput.n) ? {} : { lowSample: true }),
    },
    tools: {
      n: c.tools.runsSummarised,
      runsWithTools: c.tools.runsWithTools,
      calls: c.tools.calls,
      errors: c.tools.errors,
      errorRatePct: ratioPct(c.tools.errorRate),
    },
    worstTools: worst.map((r) => {
      const row = shapeToolRow(r);
      delete row["timed"];
      delete row["avgMs"];
      delete row["avgBytes"];
      return row;
    }),
  };
  if (input.leaders) {
    data["topAgents"] = input.leaders.slice(0, TOP_AGENTS_SHOWN).map((a) => ({
      agent: a.agentSlug,
      runs: a.runs,
      failed: a.failed,
      successRatePct: ratioPct(a.successRate),
      endToEnd: percentiles(a.wall, "s"),
      toolCalls: a.toolCalls,
      toolErrorRatePct: ratioPct(a.toolErrorRate),
    }));
  }
  return { data, coverage, caveats, worstTool: worst[0]?.tool ?? null };
}

export function buildLlm(result: LlmCallsResult, includeSubagents: boolean, limit: number): {
  data: { summary: Record<string, unknown>; byModel: Array<Record<string, unknown>> };
  coverage: Record<string, number | null>;
  caveats: string[];
} {
  const s = result.summary;
  const caveats = coverageCaveats([
    { label: "Per-LLM-call data", part: result.coverage.runsWithSeries, whole: result.coverage.runsInWindow },
  ]);
  if (result.coverage.runsWithSeries > 0 && result.coverage.runsWithSeries < result.coverage.runsInWindow * LOW_COVERAGE) {
    caveats.push("Runs finished before per-call instrumentation shipped, and some capture paths, carry no per-call series.");
  }
  if (!includeSubagents && s.subagentCalls > 0) {
    caveats.push(`${fmt(s.subagentCalls)} subagent LLM calls are excluded; pass includeSubagents=true to count them.`);
  }
  const ttft = (n: number, p50: number | null, p95: number | null) => percentiles({ n, p50Ms: p50, p95Ms: p95 }, "ms");
  const data = {
    summary: {
      n: s.calls,
      runs: s.runs,
      firstTokenWait: ttft(s.nTtft, s.p50TtftMs, s.p95TtftMs),
      decode: { n: s.nDecode, p50Ms: s.nDecode >= SAMPLE_FLOORS.p50 ? s.p50DecodeMs : null },
      tokensPerSec: s.tokensPerSec,
      avgContextTokens: s.avgContextTokens,
      avgOutputTokens: s.avgOutputTokens,
      cacheHitPct: ratioPct(s.cacheHitRate),
      retries: s.retries,
      compactions: s.compactions,
      errorStops: s.errorStops,
    },
    byModel: result.byModel.slice(0, limit).map((m) => ({
      model: m.model,
      provider: m.provider,
      n: m.calls,
      runs: m.runs,
      firstTokenWait: ttft(m.nTtft, m.p50TtftMs, m.p95TtftMs),
      tokensPerSec: m.tokensPerSec,
      avgContextTokens: m.avgContextTokens,
      retries: m.retries,
      errorStops: m.errorStops,
    })),
  };
  return {
    data,
    coverage: { runs: result.coverage.runsInWindow, withLlmSeries: result.coverage.runsWithSeries },
    caveats,
  };
}

/** Error classes for one tool. Raw samples only for own scope: at org scope they may quote other users' data. */
export function shapeClasses(rows: ErrorClassRow[], withSamples: boolean): Array<Record<string, unknown>> {
  return rows.map((r) => ({
    errorClass: cut(r.errorClass, CLASS_CHARS),
    occurrences: r.occurrences,
    runs: r.runs,
    ...(r.notFound ? { notFound: true } : {}),
    lastSeen: r.lastSeen,
    ...(withSamples && r.sample && r.sample !== r.errorClass ? { sample: cut(r.sample, SAMPLE_CHARS) } : {}),
  }));
}

export async function handleGetAgentMetrics(
  params: Record<string, unknown>,
  contextOrgId?: string,
  requestingUserId?: string,
): Promise<string> {
  const orDefault = (v: unknown, d: string): string => (v === undefined || v === null || v === "" ? d : String(v));
  const rawView = orDefault(params["view"], "overview");
  if (!VIEWS.includes(rawView as MetricsView)) return errorJson(`view must be one of ${VIEWS.join(", ")}`);
  const view = rawView as MetricsView;
  const rawSort = orDefault(params["sortBy"], "errors");
  if (!SORTS.includes(rawSort as SortBy)) return errorJson(`sortBy must be one of ${SORTS.join(", ")}`);
  const sortBy = rawSort as SortBy;
  const tool = typeof params["tool"] === "string" ? params["tool"].trim().slice(0, MAX_TOOL_NAME) : "";
  if (view === "tool_failures" && !tool) return errorJson("`tool` is required for view=tool_failures (exact tool name from view=tools)");
  const limit = clampLimit(params["limit"], view === "overview" ? DEFAULT_OVERVIEW_TOOLS : DEFAULT_LIMIT);
  const includeSubagents = params["includeSubagents"] === true || params["includeSubagents"] === "true";

  const ctx = await resolveContext(params, contextOrgId, requestingUserId);
  if ("error" in ctx) return refused("get_agent_metrics", ctx);
  const w = ctx.window;
  const base = { view, scope: scopeBlock(ctx), window: windowBlock(ctx) };
  const tabLink = (extra: Record<string, string> = {}) => ({ dashboard: dashboardLink(ctx.days, VIEW_TO_TAB[view], ctx.agentSlug, extra) });
  const agentArg = ctx.agentSlug ?? undefined;

  try {
    if (view === "overview") {
      const summary = await summaryBlock(w);
      const [rollup, leaders] = await Promise.all([
        rollupBlock(w),
        ctx.agentSlug ? Promise.resolve(null) : leaderboardBlock(w),
      ]);
      const o = buildOverview({
        current: summary.value.current,
        previous: summary.value.previous,
        rollup: rollup.value,
        leaders: leaders?.value ?? null,
        toolLimit: limit,
        days: ctx.days,
      });
      const env = {
        ...base,
        coverage: o.coverage,
        caveats: [...scopeCaveats(ctx), ...o.caveats],
        data: o.data,
        links: tabLink(),
        next: o.worstTool
          ? `Why ${o.worstTool} fails: ${call("get_agent_metrics", { view: "tool_failures", tool: o.worstTool, agentSlug: agentArg, days: ctx.days })}. ` +
            `Its sessions: ${call("find_metric_sessions", { kind: "tool_errored", tool: o.worstTool, agentSlug: agentArg, days: ctx.days })}.`
          : `Slowest runs: ${call("find_metric_sessions", { kind: "run_slow", agentSlug: agentArg, days: ctx.days })}.`,
      };
      const lists = [o.data["worstTools"] as unknown[], ...(o.data["topAgents"] ? [o.data["topAgents"] as unknown[]] : [])];
      fitBudget(env, lists);
      return JSON.stringify(env);
    }

    if (view === "tools") {
      const [rollupRes, covRes] = await Promise.all([rollupBlock(w), toolCoverageBlock(w)]);
      const rollup = rollupRes.value;
      const cov = covRes.value;
      const t = rollup.totals;
      const ranked = rankToolRows(rollup.rows, sortBy, limit);
      const rows = ranked.rows.map(shapeToolRow);
      const caveats = [...scopeCaveats(ctx), ...toolCoverageCaveats(cov)];
      if (ranked.total > rows.length) caveats.push(`Showing the top ${rows.length} of ${fmt(ranked.total)} tools by ${sortBy}.`);
      if (RATE_SORT_FLOOR[sortBy]) caveats.push(`Ranking by ${sortBy} lists tools above the sample floor first.`);
      if (rows.some((r) => r["p95Ms"] !== null || r["p95Over"] !== undefined)) caveats.push(BUCKET_CAVEAT);
      if (t.calls === 0) caveats.push("No summarised tool calls in this window for this scope.");
      const top = ranked.rows.find((r) => r.errors > 0)?.tool ?? null;
      const env = {
        ...base,
        coverage: { runs: cov.runsInWindow, withToolStats: cov.runsSummarised, runsWithTools: t.runsWithTools },
        caveats,
        data: {
          totals: {
            n: t.calls,
            tools: t.distinctTools,
            errors: t.errors,
            errorRatePct: pct1(t.errors, t.calls),
            recovered: t.recovered,
            recoveredPct: pct1(t.recovered, t.errors),
            dropped: t.dropped,
            notFound: t.notFound,
            avgMsPerCall: t.avgMsPerCall === null ? null : Math.round(t.avgMsPerCall),
          },
          sortBy,
          rows,
        },
        links: tabLink({ sort: SORT_KEY[sortBy], dir: "desc" }),
        next: top
          ? `Why ${top} fails: ${call("get_agent_metrics", { view: "tool_failures", tool: top, agentSlug: agentArg, days: ctx.days })}.`
          : `Busiest tool's sessions: ${call("find_metric_sessions", { kind: "tool_called", tool: ranked.rows[0]?.tool ?? "<tool>", agentSlug: agentArg, days: ctx.days })}.`,
      };
      fitBudget(env, [rows]);
      return JSON.stringify(env);
    }

    if (view === "tool_failures") {
      const [rollupRes, covRes] = await Promise.all([rollupBlock(w), toolCoverageBlock(w)]);
      const rollup = rollupRes.value;
      const cov = covRes.value;
      const row = rollup.rows.find((r) => r.tool === tool);
      if (!row) {
        return errorJson(`No summarised calls to "${tool}" in this window for this scope`, {
          didYouMean: closest(tool, rollup.rows.map((r) => r.tool)),
          scope: base.scope,
          window: base.window,
        });
      }
      const classes = (await errorClassesBlock(w, tool, limit)).value;
      const withSamples = ctx.scope.level === "own";
      const shaped = shapeClasses(classes.rows, withSamples);
      const caveats = [...scopeCaveats(ctx), ...toolCoverageCaveats(cov)];
      if (classes.total > shaped.length) caveats.push(`Showing the top ${shaped.length} of ${fmt(classes.total)} failure classes.`);
      if (!withSamples && shaped.length > 0) {
        caveats.push("Raw error samples are omitted at org scope (they can quote other users' data); find_metric_sessions shows samples from runs you may read.");
      }
      if (row.errors > classes.occurrences) {
        caveats.push(`${fmt(row.errors - classes.occurrences)} errored calls have no class row (dropped results or runs not yet re-summarised).`);
      }
      const env = {
        ...base,
        coverage: { runs: cov.runsInWindow, withToolStats: cov.runsSummarised, runsWithTool: row.runs },
        caveats,
        data: {
          tool: shapeToolRow(row),
          failures: { n: classes.occurrences, classes: classes.total, rows: shaped },
        },
        links: tabLink({ tool, dfilter: "errors" }),
        next: `Sessions where it errored: ${call("find_metric_sessions", { kind: "tool_errored", tool, agentSlug: agentArg, days: ctx.days })}.`,
      };
      fitBudget(env, [shaped]);
      return JSON.stringify(env);
    }

    if (view === "llm") {
      const result = (await llmBlock(w, includeSubagents)).value;
      const l = buildLlm(result, includeSubagents, limit);
      const env = {
        ...base,
        coverage: l.coverage,
        caveats: [...scopeCaveats(ctx), ...l.caveats],
        data: l.data,
        links: tabLink(includeSubagents ? { subagents: "1" } : {}),
        next: `Slowest runs: ${call("find_metric_sessions", { kind: "run_slow", agentSlug: agentArg, days: ctx.days })}.`,
      };
      fitBudget(env, [l.data.byModel]);
      return JSON.stringify(env);
    }

    const grants = await unusedGrantsBlock(w);
    const needle = tool.toLowerCase();
    const matchesTool = (name: string) => !needle || name.toLowerCase() === needle || name.toLowerCase().endsWith(`__${needle}`);
    const auditable = grants.value.agents.filter((a) => a.state !== "scoped" || (a.unused ?? 0) > 0);
    const fullyUsed = grants.value.agents.length - auditable.length;
    const agentRows = auditable.slice(0, limit).map((a) => ({
      agent: a.agentSlug,
      state: a.state,
      ...(a.openPalette ? { openPalette: a.openPalette } : {}),
      observedTools: a.observedTools,
      granted: a.granted,
      unused: a.unused,
      usedPct: ratioPct(a.usedShare),
    }));
    const groups = new Map<string, { agent: string; server: string; grants: string[] }>();
    for (const g of grants.value.unusedGrants) {
      if (!matchesTool(g.grant)) continue;
      const key = `${g.agentSlug}\u0000${g.server ?? g.kind}`;
      const entry = groups.get(key) ?? { agent: g.agentSlug, server: g.server ?? g.kind, grants: [] };
      entry.grants.push(g.grant);
      groups.set(key, entry);
    }
    const unused = [...groups.values()]
      .sort((a, b) => b.grants.length - a.grants.length || a.agent.localeCompare(b.agent))
      .slice(0, limit)
      .map((g) => ({ agent: g.agent, server: g.server, count: g.grants.length, grants: g.grants.slice(0, 6) }));

    const caveats = [...scopeCaveats(ctx)];
    const open = grants.value.agents.filter((a) => a.state === "open-palette");
    if (open.length > 0) {
      caveats.push(
        `${open.length} agent(s) have an open palette (${open.slice(0, 3).map((a) => `${a.agentSlug}: ${a.openPalette}`).join(", ")}); ` +
          "they can reach any non-destructive tool, so unused grants cover only their pinned grants.",
      );
    }
    const unscoped = grants.value.agents.filter((a) => a.state === "unscoped").length;
    if (unscoped > 0) caveats.push(`${unscoped} agent(s) have no tool list (unscoped); they are not audited for unused grants.`);
    if (auditable.length > agentRows.length) caveats.push(`Showing ${agentRows.length} of ${auditable.length} agents with unused grants or an open palette.`);

    const env = {
      ...base,
      coverage: { agents: grants.value.agents.length },
      caveats,
      data: { agents: { n: grants.value.agents.length, usingEveryGrant: fullyUsed, rows: agentRows }, unusedGrants: unused },
      links: tabLink(),
      next: `Tool reliability: ${call("get_agent_metrics", { view: "tools", agentSlug: agentArg, days: ctx.days })}.`,
    };
    fitBudget(env, [unused, agentRows]);
    return JSON.stringify(env);
  } catch (err) {
    return failure("get_agent_metrics", err);
  }
}

/** One session row, compact, with the agent-tool text rule applied on top of the lib's redaction. */
export function shapeSession(r: MetricSessionRow, aliases: string[]): Record<string, unknown> {
  const byYou = aliases.includes(r.userId);
  const textAllowed = !r.restricted && (byYou || SYSTEM_TRIGGERS.has(r.triggerSource));
  const row: Record<string, unknown> = {
    sessionId: r.sessionId,
    agent: r.agentSlug,
    finishedAt: r.completedAt,
    status: r.status,
    durationS: secs(r.durationMs),
    trigger: r.triggerSource,
    byYou,
  };
  if (r.restricted) row["restricted"] = true;
  if (r.tool) row["tool"] = { calls: r.tool.c, errors: r.tool.e, recovered: r.tool.rec, dropped: r.tool.d };
  if (r.split) {
    row["split"] = {
      llmS: secs(r.split.llmMs),
      toolS: secs(r.split.toolMs),
      topTools: r.split.topTools.slice(0, 3).map((t) => ({ tool: t.tool, ms: t.ms, calls: t.calls })),
    };
  }
  if (textAllowed) {
    const sample = cut(r.sample ?? null, SAMPLE_CHARS);
    const error = cut(r.error ?? null, SAMPLE_CHARS);
    const task = cut(r.task, TASK_CHARS);
    if (sample) row["errorSample"] = sample;
    if (error) row["error"] = error;
    if (task) row["task"] = task;
  }
  return row;
}

export async function handleFindMetricSessions(
  params: Record<string, unknown>,
  contextOrgId?: string,
  requestingUserId?: string,
): Promise<string> {
  const kind = String(params["kind"] ?? "") as SessionsKind;
  if (!KINDS.includes(kind)) return errorJson(`kind must be one of ${KINDS.join(", ")}`);
  const mapped = KIND_TO_REQUEST[kind];
  const tool = typeof params["tool"] === "string" ? params["tool"].trim() : "";
  if (mapped.kind === "tool" && !tool) return errorJson(`\`tool\` is required for kind=${kind} (exact tool name from get_agent_metrics view=tools)`);
  if (tool.length > MAX_TOOL_NAME) return errorJson("tool name too long");
  const cursor = typeof params["cursor"] === "string" && params["cursor"].trim() ? params["cursor"].trim() : undefined;
  if (cursor && cursor.length > MAX_CURSOR) return errorJson("invalid cursor");
  const limit = clampLimit(params["limit"], DEFAULT_SESSIONS);

  const ctx = await resolveContext(params, contextOrgId, requestingUserId);
  if ("error" in ctx) return refused("find_metric_sessions", ctx);

  try {
    const aliases = await userIdAliasesFor(ctx.scope.requesterId);
    if (!aliases.includes(ctx.scope.requesterId)) aliases.push(ctx.scope.requesterId);
    const result: MetricSessionsResult = await fetchMetricSessions(
      ctx.window,
      {
        kind: mapped.kind,
        ...(mapped.kind === "tool" ? { tool, signal: mapped.signal } : {}),
        limit,
        ...(cursor ? { cursor } : {}),
        count: !cursor,
      },
      { requesterAliases: aliases, isAdmin: ctx.scope.isAdmin, strictText: true },
    );
    const sessions = result.rows.map((r) => shapeSession(r, aliases));

    const caveats = [...scopeCaveats(ctx)];
    if (mapped.kind === "tool") {
      const cov = result.coverage;
      if (cov.runsInWindow > 0 && cov.runsSummarised / cov.runsInWindow < LOW_COVERAGE) {
        caveats.push(`Only ${fmt(cov.runsSummarised)} of ${fmt(cov.runsInWindow)} runs in this window have tool stats; the rest cannot be found by tool yet.`);
      }
    }
    if (kind === "run_failed") caveats.push("run_failed lists failed and cancelled runs.");
    if (kind === "run_slow") caveats.push("Ordered by end-to-end time (completed runs only), slowest first.");
    const restricted = sessions.filter((s) => s["restricted"] === true).length;
    if (restricted > 0) caveats.push(`${restricted} session(s) on this page ran under another user's personal token; only figures are shown.`);
    const withheld = sessions.filter((s) => s["restricted"] !== true && s["byYou"] !== true && !SYSTEM_TRIGGERS.has(String(s["trigger"]))).length;
    if (withheld > 0) caveats.push(`Task and error text withheld for ${withheld} session(s) other users started; it is shown only for your own and scheduled or automation runs.`);
    if (result.total?.capped) caveats.push(`More than ${fmt(result.total.value)} sessions match; the total is capped.`);

    const drill: Record<string, string> = { ...KIND_TO_DRILL[kind] };
    const tab = drill["tab"]!;
    delete drill["tab"];
    if (mapped.kind === "tool") drill["tool"] = tool;
    const nextCall = (c: string | null) =>
      c ? `Next page: ${call("find_metric_sessions", { kind, tool: tool || undefined, agentSlug: ctx.agentSlug ?? undefined, days: ctx.days, limit, cursor: c })}` : null;
    const env = {
      kind,
      ...(tool ? { tool } : {}),
      scope: scopeBlock(ctx),
      window: windowBlock(ctx),
      ...(mapped.kind === "tool" ? { coverage: result.coverage } : {}),
      total: result.total ? { n: result.total.value, capped: result.total.capped } : null,
      caveats,
      sessions,
      page: { limit: result.page.limit, hasMore: result.page.hasMore, cursor: result.page.nextCursor },
      links: { dashboard: dashboardLink(ctx.days, tab, ctx.agentSlug, drill), session: `${CONFIG.frontendUrl}v3/runs?session=<sessionId>` },
      next: nextCall(result.page.nextCursor),
    };
    // The lib's cursor points past rows the budget drops: re-key on the last kept row (sort keys are
    // whole ms, so exact). The new cursor can itself push the page over, hence the loop.
    const rekey = () => {
      const last = result.rows[sessions.length - 1];
      if (!last) return;
      const k = mapped.kind === "slow" ? (last.durationMs ?? 0) : Date.parse(last.completedAt ?? last.startedAt);
      const c = encodeCursor({ w: mapped.kind === "slow" ? "wall" : "completedAt", k, id: last.id });
      env.page = { ...env.page, hasMore: true, cursor: c };
      env.next = nextCall(c);
    };
    if (fitBudget(env, [sessions]) > 0) {
      rekey();
      while (Buffer.byteLength(JSON.stringify(env), "utf8") > OUTPUT_BUDGET_BYTES && sessions.length > 1) {
        sessions.pop();
        rekey();
      }
    }
    return JSON.stringify(env);
  } catch (err) {
    return failure("find_metric_sessions", err);
  }
}
