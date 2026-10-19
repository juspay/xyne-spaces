/**
 * Run-level metrics: one row per finished run, aggregated over a window.
 *
 * Scalar statements must stay index-only scans of "agent_runs_metrics_window_idx":
 * `orgId =` plus a `completedAt` range, the orphan exclusion spelled literally so
 * the partial predicate matches, and only INCLUDEd columns. Any other column
 * (result, toolInvocations) turns a ~30 ms walk into a heap scan of the window.
 * Tool totals come from agent_run_stats and sentiment (which needs the heap)
 * has its own statement. Every average, percentile and rate carries its n.
 */

import { Prisma } from "@prisma/client";
import { getOrgNameMap } from "./admin-org-scope.js";
import {
  PROMPT_TOKENS,
  TRIGGER_GROUP,
  WALL_MS,
  agentPredicate,
  previousWindow,
  rate,
  runAnalytics,
  statsWindowPredicate,
  windowPredicate,
  type AnalyticsWindow,
  type TriggerGroup,
} from "./metrics-core.js";


export interface PctBlock { n: number; p50Ms: number | null; p95Ms: number | null }

export interface SummaryFigures {
  runs: number;
  delegatedRuns: number;
  completed: number;
  failed: number;
  cancelled: number;
  successRate: number | null;
  users: number;
  /** completedAt - startedAt, completed runs only. */
  wall: PctBlock;
  /** Claw-measured totalMs, over the runs that recorded it. */
  agent: PctBlock & { avgLlmMs: number | null; avgToolMs: number | null; avgOtherMs: number | null };
  replyStart: PctBlock;
  /** Per-run figures divide by `n` (runs that recorded tokens). prompt = fresh + cached. */
  tokens: {
    n: number;
    promptPerRun: number | null;
    outputPerRun: number | null;
    freshPerRun: number | null;
    cachedPerRun: number | null;
    cacheHitRate: number | null;
    promptTotal: number;
    outputTotal: number;
    freshTotal: number;
    cacheReadTotal: number;
    cacheWriteTotal: number;
  };
  throughput: { n: number; tokensPerSec: number | null };
  /** From agent_run_stats; runsSummarised vs `runs` is capture coverage. */
  tools: {
    runsWithTools: number;
    runsSummarised: number;
    calls: number;
    errors: number;
    errorRate: number | null;
  };
  llm: { runsWithSeries: number; nTurns: number; avgTurns: number | null };
}

export interface DailyPoint {
  day: string;
  runs: number;
  completed: number;
  failed: number;
  cancelled: number;
  byTrigger: Partial<Record<TriggerGroup, number>>;
  wall: PctBlock;
  agent: { n: number; avgLlmMs: number | null; avgToolMs: number | null; totalLlmMs: number; totalToolMs: number };
  tokens: { n: number; prompt: number; output: number };
}

export interface TriggerRow {
  group: TriggerGroup;
  runs: number;
  completed: number;
  failed: number;
  cancelled: number;
  successRate: number | null;
  wall: PctBlock;
}

export interface AgentLeaderRow {
  agentSlug: string;
  orgId: string;
  orgName?: string | null;
  runs: number;
  failed: number;
  successRate: number | null;
  wall: PctBlock;
  agent: { n: number; avgLlmMs: number | null; avgToolMs: number | null };
  tokens: { n: number; promptPerRun: number | null; outputPerRun: number | null };
  toolCalls: number;
  toolErrorRate: number | null;
}

export interface RouteRow {
  route: string;
  model: string | null;
  runs: number;
  timed: number;
  llm: PctBlock;
  replyStart: PctBlock;
  tokensPerSec: number | null;
  failed: number;
  errorRate: number | null;
}

export interface SentimentComment {
  sessionId: string;
  rating: "up" | "down";
  comment: string;
  completedAt: string;
}

export interface AgentSentiment {
  totalRuns: number;
  ratingUp: number;
  ratingDown: number;
  ratingTotal: number;
  ratingRatio: number | null;
  cancelledRate: number;
  failedRate: number;
  retriedRate: number;
  retriesKnown: number;
  apologeticRate: number;
  recentComments: SentimentComment[];
}

export interface MemoryRecall {
  recalled: number;
  runs: number;
  rate: number | null;
  /** False when no recall was ever recorded in scope: 0 then means "not captured". */
  captured: boolean;
}


const n0 = (v: unknown): number => (v == null ? 0 : Number(v));
const roundOrNull = (v: unknown): number | null => (v == null ? null : Math.round(Number(v)));
const pct = (n: unknown, p50: unknown, p95: unknown): PctBlock => {
  const c = n0(n);
  return { n: c, p50Ms: c > 0 ? roundOrNull(p50) : null, p95Ms: c > 0 ? roundOrNull(p95) : null };
};
const avgMs = (n: number, v: unknown): number | null => (n > 0 ? roundOrNull(v) : null);
const perRun = (total: number, n: number): number | null => (n > 0 ? Math.round(total / n) : null);
const weightedTps = (out: unknown, decodeMs: unknown): number | null => {
  const ms = n0(decodeMs);
  return ms > 0 ? Math.round((n0(out) * 1000) / ms) : null;
};

/** The pool is shared with the run path. */
const MAX_PARALLEL = 3;

export async function boundedAll<T>(tasks: Array<() => Promise<T>>, limit = MAX_PARALLEL): Promise<T[]> {
  const out = new Array<T>(tasks.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < tasks.length) {
      const i = next++;
      out[i] = await tasks[i]!();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return out;
}


const HAS_TOKENS = Prisma.raw(
  `COALESCE(r."tokensIn", r."tokensOut", r."tokensCacheRead", r."tokensCacheWrite") IS NOT NULL`,
);
const TPS_ROW = Prisma.raw(`r."tokensOut" > 0 AND r."llmDecodeMs" > 0`);

const STATUS_COUNTS = Prisma.sql`
  count(*)::int                                                AS runs,
  count(*) FILTER (WHERE r."status" = 'completed')::int        AS completed,
  count(*) FILTER (WHERE r."status" = 'failed')::int           AS failed,
  count(*) FILTER (WHERE r."status" = 'cancelled')::int        AS cancelled`;

const WALL_PCT = Prisma.sql`
  count(*) FILTER (WHERE r."status" = 'completed')::int        AS wall_n,
  percentile_cont(0.5)  WITHIN GROUP (ORDER BY ${WALL_MS()}) FILTER (WHERE r."status" = 'completed') AS wall_p50,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY ${WALL_MS()}) FILTER (WHERE r."status" = 'completed') AS wall_p95`;

/** Same rows as agent_n, so llm + tool + other add up to the agent time. */
const AGENT_AVGS = Prisma.sql`
  count(r."totalMs")::int                                      AS agent_n,
  avg(r."llmTotalMs") FILTER (WHERE r."totalMs" IS NOT NULL)::float8 AS avg_llm,
  avg(r."toolMs")     FILTER (WHERE r."totalMs" IS NOT NULL)::float8 AS avg_tool`;

const TOKEN_SUMS = Prisma.sql`
  count(*) FILTER (WHERE ${HAS_TOKENS})::int                   AS tokens_n,
  COALESCE(sum(${PROMPT_TOKENS()}), 0)::float8                 AS prompt_total,
  COALESCE(sum(r."tokensOut"), 0)::float8                      AS output_total`;

const TPS_SUMS = Prisma.sql`
  count(*) FILTER (WHERE ${TPS_ROW})::int                      AS tps_n,
  sum(r."tokensOut")   FILTER (WHERE ${TPS_ROW})::float8       AS tps_out,
  sum(r."llmDecodeMs") FILTER (WHERE ${TPS_ROW})::float8       AS tps_decode_ms`;


interface SummaryRow {
  runs: number; completed: number; failed: number; cancelled: number;
  delegated: number; users: number;
  wall_n: number; wall_p50: number | null; wall_p95: number | null;
  agent_n: number; agent_p50: number | null; agent_p95: number | null;
  avg_llm: number | null; avg_tool: number | null; avg_other: number | null;
  ttft_n: number; ttft_p50: number | null; ttft_p95: number | null;
  tokens_n: number; prompt_total: number; output_total: number;
  fresh_total: number; cache_read_total: number; cache_write_total: number;
  tps_n: number; tps_out: number | null; tps_decode_ms: number | null;
  turns_n: number; avg_turns: number | null;
}

interface StatsFigures { summarised: number; withTools: number; calls: number; errors: number; series: number }

/** Index-only. */
export function runSummarySql(w: AnalyticsWindow): Prisma.Sql {
  return Prisma.sql`
    SELECT
      ${STATUS_COUNTS},
      count(*) FILTER (WHERE r."parentSessionId" IS NOT NULL)::int AS delegated,
      count(DISTINCT r."userId")::int                              AS users,
      ${WALL_PCT},
      ${AGENT_AVGS},
      percentile_cont(0.5)  WITHIN GROUP (ORDER BY r."totalMs")    AS agent_p50,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY r."totalMs")    AS agent_p95,
      avg(GREATEST(r."totalMs" - COALESCE(r."llmTotalMs", 0) - COALESCE(r."toolMs", 0), 0))::float8 AS avg_other,
      count(r."ttftMs")::int                                       AS ttft_n,
      percentile_cont(0.5)  WITHIN GROUP (ORDER BY r."ttftMs")     AS ttft_p50,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY r."ttftMs")     AS ttft_p95,
      ${TOKEN_SUMS},
      COALESCE(sum(r."tokensIn"), 0)::float8                       AS fresh_total,
      COALESCE(sum(r."tokensCacheRead"), 0)::float8                AS cache_read_total,
      COALESCE(sum(r."tokensCacheWrite"), 0)::float8               AS cache_write_total,
      ${TPS_SUMS},
      count(r."llmTurns")::int                                     AS turns_n,
      avg(r."llmTurns")::float8                                    AS avg_turns
    FROM "agent_runs" r
    WHERE ${windowPredicate(w)}
  `;
}

/** Current and previous window in one pass over agent_run_stats; scalar columns only (never llmCalls or toolNames). */
export function statsSummarySql(current: AnalyticsWindow, previous: AnalyticsWindow): Prisma.Sql {
  const span: AnalyticsWindow = { ...current, windowStart: previous.windowStart };
  const cur = Prisma.sql`s."completedAt" >= ${current.windowStart}`;
  const prev = Prisma.sql`s."completedAt" < ${current.windowStart}`;
  return Prisma.sql`
    SELECT
      count(*) FILTER (WHERE ${cur})::int                                        AS cur_summarised,
      count(*) FILTER (WHERE ${cur} AND s."toolCalls" > 0)::int                  AS cur_with_tools,
      COALESCE(sum(s."toolCalls") FILTER (WHERE ${cur}), 0)::float8             AS cur_calls,
      COALESCE(sum(s."toolErrors") FILTER (WHERE ${cur}), 0)::float8            AS cur_errors,
      count(s."llmCallCount") FILTER (WHERE ${cur})::int                         AS cur_series,
      count(*) FILTER (WHERE ${prev})::int                                       AS prev_summarised,
      count(*) FILTER (WHERE ${prev} AND s."toolCalls" > 0)::int                 AS prev_with_tools,
      COALESCE(sum(s."toolCalls") FILTER (WHERE ${prev}), 0)::float8            AS prev_calls,
      COALESCE(sum(s."toolErrors") FILTER (WHERE ${prev}), 0)::float8           AS prev_errors,
      count(s."llmCallCount") FILTER (WHERE ${prev})::int                        AS prev_series
    FROM "agent_run_stats" s
    WHERE ${statsWindowPredicate(span)}
  `;
}

function toSummary(r: SummaryRow | undefined, stats: StatsFigures): SummaryFigures {
  const runs = n0(r?.runs);
  const completed = n0(r?.completed);
  const tokensN = n0(r?.tokens_n);
  const prompt = n0(r?.prompt_total);
  const fresh = n0(r?.fresh_total);
  const cacheRead = n0(r?.cache_read_total);
  const cacheWrite = n0(r?.cache_write_total);
  const agentN = n0(r?.agent_n);
  return {
    runs,
    delegatedRuns: n0(r?.delegated),
    completed,
    failed: n0(r?.failed),
    cancelled: n0(r?.cancelled),
    successRate: rate(completed, runs),
    users: n0(r?.users),
    wall: pct(r?.wall_n, r?.wall_p50, r?.wall_p95),
    agent: {
      ...pct(agentN, r?.agent_p50, r?.agent_p95),
      avgLlmMs: avgMs(agentN, r?.avg_llm),
      avgToolMs: avgMs(agentN, r?.avg_tool),
      avgOtherMs: avgMs(agentN, r?.avg_other),
    },
    replyStart: pct(r?.ttft_n, r?.ttft_p50, r?.ttft_p95),
    tokens: {
      n: tokensN,
      promptPerRun: perRun(prompt, tokensN),
      outputPerRun: perRun(n0(r?.output_total), tokensN),
      freshPerRun: perRun(fresh, tokensN),
      cachedPerRun: perRun(cacheRead + cacheWrite, tokensN),
      cacheHitRate: rate(cacheRead, prompt),
      promptTotal: prompt,
      outputTotal: n0(r?.output_total),
      freshTotal: fresh,
      cacheReadTotal: cacheRead,
      cacheWriteTotal: cacheWrite,
    },
    throughput: { n: n0(r?.tps_n), tokensPerSec: weightedTps(r?.tps_out, r?.tps_decode_ms) },
    tools: {
      runsWithTools: stats.withTools,
      runsSummarised: stats.summarised,
      calls: stats.calls,
      errors: stats.errors,
      errorRate: rate(stats.errors, stats.calls),
    },
    llm: {
      runsWithSeries: stats.series,
      nTurns: n0(r?.turns_n),
      avgTurns: r?.avg_turns == null ? null : Number(Number(r.avg_turns).toFixed(2)),
    },
  };
}

/** Headline figures for the window and the window before it; `previous` is null when that holds no runs. */
export async function fetchRunSummary(w: AnalyticsWindow): Promise<{ current: SummaryFigures; previous: SummaryFigures | null }> {
  const prev = previousWindow(w);
  const [cur, before, st] = await boundedAll<unknown[]>([
    () => runAnalytics<SummaryRow>(runSummarySql(w)),
    () => runAnalytics<SummaryRow>(runSummarySql(prev)),
    () => runAnalytics<Record<string, number>>(statsSummarySql(w, prev)),
  ]);
  const t = (st as Array<Record<string, unknown>>)[0];
  const stats = (side: "cur" | "prev"): StatsFigures => ({
    summarised: n0(t?.[`${side}_summarised`]),
    withTools: n0(t?.[`${side}_with_tools`]),
    calls: n0(t?.[`${side}_calls`]),
    errors: n0(t?.[`${side}_errors`]),
    series: n0(t?.[`${side}_series`]),
  });
  const current = toSummary((cur as SummaryRow[])[0], stats("cur"));
  const prevRow = (before as SummaryRow[])[0];
  const previous = n0(prevRow?.runs) > 0 ? toSummary(prevRow, stats("prev")) : null;
  return { current, previous };
}


interface DailyRow {
  day: string | null; grp: TriggerGroup | null; g_day: number; g_grp: number;
  runs: number; completed: number; failed: number; cancelled: number;
  wall_n: number; wall_p50: number | null; wall_p95: number | null;
  agent_n: number; avg_llm: number | null; avg_tool: number | null; total_llm: number; total_tool: number;
  tokens_n: number; prompt_total: number; output_total: number;
}

/** Per-day, per-trigger and per-day-per-trigger rollups in one index-only scan. The day is computed in a subquery so the GROUP BY never matches two separately bound copies of `tz`. */
export function runDailySql(w: AnalyticsWindow, tz: string): Prisma.Sql {
  return Prisma.sql`
    SELECT
      to_char(s.day, 'YYYY-MM-DD')                                  AS day,
      s.grp                                                         AS grp,
      GROUPING(s.day)::int                                          AS g_day,
      GROUPING(s.grp)::int                                          AS g_grp,
      count(*)::int                                                 AS runs,
      count(*) FILTER (WHERE s.status = 'completed')::int           AS completed,
      count(*) FILTER (WHERE s.status = 'failed')::int              AS failed,
      count(*) FILTER (WHERE s.status = 'cancelled')::int           AS cancelled,
      count(*) FILTER (WHERE s.status = 'completed')::int           AS wall_n,
      percentile_cont(0.5)  WITHIN GROUP (ORDER BY s.wall) FILTER (WHERE s.status = 'completed') AS wall_p50,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY s.wall) FILTER (WHERE s.status = 'completed') AS wall_p95,
      count(s.total_ms)::int                                        AS agent_n,
      avg(s.llm_ms)  FILTER (WHERE s.total_ms IS NOT NULL)::float8  AS avg_llm,
      avg(s.tool_ms) FILTER (WHERE s.total_ms IS NOT NULL)::float8  AS avg_tool,
      COALESCE(sum(s.llm_ms)  FILTER (WHERE s.total_ms IS NOT NULL), 0)::float8 AS total_llm,
      COALESCE(sum(s.tool_ms) FILTER (WHERE s.total_ms IS NOT NULL), 0)::float8 AS total_tool,
      count(*) FILTER (WHERE s.has_tokens)::int                     AS tokens_n,
      COALESCE(sum(s.prompt), 0)::float8                            AS prompt_total,
      COALESCE(sum(s.output), 0)::float8                            AS output_total
    FROM (
      SELECT
        ((r."completedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz})::date AS day,
        ${TRIGGER_GROUP()}                                          AS grp,
        r."status"                                                  AS status,
        ${WALL_MS()}                                                AS wall,
        r."totalMs"                                                 AS total_ms,
        r."llmTotalMs"                                              AS llm_ms,
        r."toolMs"                                                  AS tool_ms,
        ${PROMPT_TOKENS()}                                          AS prompt,
        r."tokensOut"                                               AS output,
        ${HAS_TOKENS}                                               AS has_tokens
      FROM "agent_runs" r
      WHERE ${windowPredicate(w)}
    ) s
    GROUP BY GROUPING SETS ((s.day), (s.grp), (s.day, s.grp))
  `;
}

function localDay(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** Every calendar day the window touches in `tz`, oldest first. */
export function calendarDays(w: AnalyticsWindow, tz: string): string[] {
  const first = localDay(w.windowStart, tz);
  const last = localDay(new Date(w.windowEnd.getTime() - 1), tz);
  const days: string[] = [];
  // Step in UTC midnights so a DST shift cannot skip or repeat a day.
  for (let t = Date.parse(`${first}T00:00:00Z`), end = Date.parse(`${last}T00:00:00Z`); t <= end; t += 86_400_000) {
    days.push(new Date(t).toISOString().slice(0, 10));
    if (days.length > 400) break;
  }
  return days;
}

const emptyDay = (day: string): DailyPoint => ({
  day,
  runs: 0,
  completed: 0,
  failed: 0,
  cancelled: 0,
  byTrigger: {},
  wall: { n: 0, p50Ms: null, p95Ms: null },
  agent: { n: 0, avgLlmMs: null, avgToolMs: null, totalLlmMs: 0, totalToolMs: 0 },
  tokens: { n: 0, prompt: 0, output: 0 },
});

export async function fetchRunDaily(w: AnalyticsWindow, tz: string): Promise<{ days: DailyPoint[]; triggers: TriggerRow[] }> {
  const rows = await runAnalytics<DailyRow>(runDailySql(w, tz));
  const byDay = new Map<string, DailyPoint>(calendarDays(w, tz).map((d) => [d, emptyDay(d)]));
  const triggers: TriggerRow[] = [];

  for (const r of rows) {
    const dayGrouped = n0(r.g_day) === 0;
    const grpGrouped = n0(r.g_grp) === 0;
    if (dayGrouped && grpGrouped) {
      if (r.day && r.grp) {
        const point = byDay.get(r.day) ?? emptyDay(r.day);
        point.byTrigger[r.grp] = n0(r.runs);
        byDay.set(r.day, point);
      }
    } else if (dayGrouped && r.day) {
      const point = byDay.get(r.day) ?? emptyDay(r.day);
      const agentN = n0(r.agent_n);
      Object.assign(point, {
        runs: n0(r.runs),
        completed: n0(r.completed),
        failed: n0(r.failed),
        cancelled: n0(r.cancelled),
        wall: pct(r.wall_n, r.wall_p50, r.wall_p95),
        agent: {
          n: agentN,
          avgLlmMs: avgMs(agentN, r.avg_llm),
          avgToolMs: avgMs(agentN, r.avg_tool),
          totalLlmMs: Math.round(n0(r.total_llm)),
          totalToolMs: Math.round(n0(r.total_tool)),
        },
        tokens: { n: n0(r.tokens_n), prompt: n0(r.prompt_total), output: n0(r.output_total) },
      });
      byDay.set(r.day, point);
    } else if (grpGrouped && r.grp && n0(r.runs) > 0) {
      const runs = n0(r.runs);
      const completed = n0(r.completed);
      triggers.push({
        group: r.grp,
        runs,
        completed,
        failed: n0(r.failed),
        cancelled: n0(r.cancelled),
        successRate: rate(completed, runs),
        wall: pct(r.wall_n, r.wall_p50, r.wall_p95),
      });
    }
  }

  triggers.sort((a, b) => b.runs - a.runs || a.group.localeCompare(b.group));
  return { days: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)), triggers };
}


interface LeaderRow {
  agent_slug: string; org_id: string;
  runs: number; completed: number; failed: number; cancelled: number;
  wall_n: number; wall_p50: number | null; wall_p95: number | null;
  agent_n: number; avg_llm: number | null; avg_tool: number | null;
  tokens_n: number; prompt_total: number; output_total: number;
  tool_calls: number; tool_errors: number;
}

/** Tool totals scan the whole window's stats once, then join to the listed agents: pre-filtering made the planner probe per agent. */
export function agentLeaderboardSql(w: AnalyticsWindow, limit: number): Prisma.Sql {
  return Prisma.sql`
    WITH top AS (
      SELECT
        r."agentSlug"                                              AS agent_slug,
        r."orgId"                                                  AS org_id,
        ${STATUS_COUNTS},
        ${WALL_PCT},
        ${AGENT_AVGS},
        ${TOKEN_SUMS}
      FROM "agent_runs" r
      WHERE ${windowPredicate(w)}
      GROUP BY r."agentSlug", r."orgId"
      ORDER BY runs DESC, agent_slug ASC
      LIMIT ${limit}
    ), tools AS (
      SELECT s."agentSlug" AS agent_slug, s."orgId" AS org_id,
             sum(s."toolCalls")::float8 AS tool_calls, sum(s."toolErrors")::float8 AS tool_errors
      FROM "agent_run_stats" s
      WHERE ${statsWindowPredicate(w)}
      GROUP BY 1, 2
    )
    SELECT top.*, COALESCE(tools.tool_calls, 0) AS tool_calls, COALESCE(tools.tool_errors, 0) AS tool_errors
    FROM top LEFT JOIN tools USING (agent_slug, org_id)
    ORDER BY top.runs DESC, top.agent_slug ASC
  `;
}

export async function fetchAgentLeaderboard(w: AnalyticsWindow, limit: number): Promise<AgentLeaderRow[]> {
  const rows = await runAnalytics<LeaderRow>(agentLeaderboardSql(w, Math.max(1, Math.trunc(limit))));
  const orgNames = w.allOrgs ? await getOrgNameMap(rows.map((r) => r.org_id)) : null;
  return rows.map((r) => {
    const runs = n0(r.runs);
    const agentN = n0(r.agent_n);
    const tokensN = n0(r.tokens_n);
    const calls = n0(r.tool_calls);
    return {
      agentSlug: r.agent_slug,
      orgId: r.org_id,
      ...(orgNames ? { orgName: orgNames.get(r.org_id) ?? r.org_id } : {}),
      runs,
      failed: n0(r.failed),
      successRate: rate(n0(r.completed), runs),
      wall: pct(r.wall_n, r.wall_p50, r.wall_p95),
      agent: {
        n: agentN,
        avgLlmMs: avgMs(agentN, r.avg_llm),
        avgToolMs: avgMs(agentN, r.avg_tool),
      },
      tokens: {
        n: tokensN,
        promptPerRun: perRun(n0(r.prompt_total), tokensN),
        outputPerRun: perRun(n0(r.output_total), tokensN),
      },
      toolCalls: calls,
      toolErrorRate: rate(n0(r.tool_errors), calls),
    };
  });
}

const ACTIVE_AGENTS_LIMIT = 500;

/** Index-only. */
export function activeAgentsSql(w: AnalyticsWindow): Prisma.Sql {
  return Prisma.sql`
    SELECT r."agentSlug" AS agent_slug, r."orgId" AS org_id, count(*)::int AS runs
    FROM "agent_runs" r
    WHERE ${windowPredicate(w)}
    GROUP BY r."agentSlug", r."orgId"
    ORDER BY runs DESC, agent_slug ASC
    LIMIT ${ACTIVE_AGENTS_LIMIT}
  `;
}

export async function fetchActiveAgents(w: AnalyticsWindow): Promise<Array<{ agentSlug: string; orgId: string; runs: number }>> {
  const rows = await runAnalytics<{ agent_slug: string; org_id: string; runs: number }>(activeAgentsSql(w));
  return rows.map((r) => ({ agentSlug: r.agent_slug, orgId: r.org_id, runs: n0(r.runs) }));
}


interface RouteSqlRow {
  route: string; model: string | null;
  runs: number; completed: number; failed: number; cancelled: number;
  timed: number; llm_p50: number | null; llm_p95: number | null;
  ttft_n: number; ttft_p50: number | null; ttft_p95: number | null;
  tps_n: number; tps_out: number | null; tps_decode_ms: number | null;
}

/** Index-only. */
export function routeTableSql(w: AnalyticsWindow): Prisma.Sql {
  return Prisma.sql`
    SELECT
      r."provider"                                                 AS route,
      r."model"                                                    AS model,
      ${STATUS_COUNTS},
      count(r."llmTotalMs")::int                                   AS timed,
      percentile_cont(0.5)  WITHIN GROUP (ORDER BY r."llmTotalMs") AS llm_p50,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY r."llmTotalMs") AS llm_p95,
      count(r."ttftMs")::int                                       AS ttft_n,
      percentile_cont(0.5)  WITHIN GROUP (ORDER BY r."ttftMs")     AS ttft_p50,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY r."ttftMs")     AS ttft_p95,
      ${TPS_SUMS}
    FROM "agent_runs" r
    WHERE ${windowPredicate(w)}
      AND r."provider" IS NOT NULL
    GROUP BY r."provider", r."model"
    ORDER BY runs DESC, route ASC, model ASC NULLS LAST
  `;
}

export async function fetchRouteTable(w: AnalyticsWindow): Promise<RouteRow[]> {
  const rows = await runAnalytics<RouteSqlRow>(routeTableSql(w));
  return rows.map((r) => {
    const runs = n0(r.runs);
    return {
      route: r.route,
      model: r.model,
      runs,
      timed: n0(r.timed),
      llm: pct(r.timed, r.llm_p50, r.llm_p95),
      replyStart: pct(r.ttft_n, r.ttft_p50, r.ttft_p95),
      tokensPerSec: weightedTps(r.tps_out, r.tps_decode_ms),
      failed: n0(r.failed),
      errorRate: rate(runs - n0(r.completed), runs),
    };
  });
}


/** "The agent said it could not do it". String.raw + a bind: a Prisma.sql template cooks the backslashes away. */
export const APOLOGETIC_PATTERN = String.raw`\m(I couldn|I can\W?t|I don\W?t have|sorry|unable to|I am not able|I cannot|I do not have|I don\W?t know|no findings|I was unable)`;

/** Reads `result` and `ratingComment`, so not index-only; always agent-scoped by the caller. */
export function sentimentSql(w: AnalyticsWindow): Prisma.Sql {
  return Prisma.sql`
    SELECT
      count(*)::int                                                AS total_runs,
      count(*) FILTER (WHERE r."rating" = 'up')::int               AS rating_up,
      count(*) FILTER (WHERE r."rating" = 'down')::int             AS rating_down,
      count(*) FILTER (WHERE r."status" = 'cancelled')::int        AS cancelled,
      count(*) FILTER (WHERE r."status" = 'failed')::int           AS failed,
      count(r."llmRetries")::int                                   AS retries_known,
      count(*) FILTER (WHERE r."llmRetries" > 0)::int              AS retried,
      count(*) FILTER (WHERE r."status" = 'completed')::int        AS completed,
      count(*) FILTER (
        WHERE r."status" = 'completed' AND r."result" IS NOT NULL AND r."result" ~* ${APOLOGETIC_PATTERN}
      )::int                                                       AS apologetic
    FROM "agent_runs" r
    WHERE ${windowPredicate(w)}
  `;
}

export function sentimentCommentsSql(w: AnalyticsWindow): Prisma.Sql {
  return Prisma.sql`
    SELECT r."sessionId" AS session_id, r."rating" AS rating, r."ratingComment" AS comment, r."completedAt" AS completed_at
    FROM "agent_runs" r
    WHERE ${windowPredicate(w)}
      AND r."rating" IN ('up', 'down')
      AND r."ratingComment" IS NOT NULL
      AND btrim(r."ratingComment") <> ''
    ORDER BY r."ratedAt" DESC NULLS LAST
    LIMIT 12
  `;
}

/** Sessions that recalled >= 1 memory, scoped like the runs they are divided by (else the rate could exceed 1). */
export function memoryRecallSql(w: AnalyticsWindow): Prisma.Sql {
  const orgOf = (a: string): Prisma.Sql => (!w.allOrgs && w.orgId !== undefined ? Prisma.sql`AND ${Prisma.raw(a)}."orgId" = ${w.orgId}` : Prisma.empty);
  const org = orgOf("h");
  const user = w.userId !== undefined ? Prisma.sql`AND h."userId" = ${w.userId}` : Prisma.empty;
  const capturedOrg = orgOf("x");
  return Prisma.sql`
    SELECT
      count(DISTINCT h."sessionId")::int AS recalled,
      EXISTS (
        SELECT 1 FROM "memory_recall_hits" x
        WHERE TRUE ${agentPredicate(w.agentSlugs, "x")} ${capturedOrg}
      ) AS captured
    FROM "memory_recall_hits" h
    WHERE TRUE ${agentPredicate(w.agentSlugs, "h")} ${org} ${user}
      AND h."sessionId" IN (SELECT r."sessionId" FROM "agent_runs" r WHERE ${windowPredicate(w)})
  `;
}

interface SentimentRow {
  total_runs: number; rating_up: number; rating_down: number; cancelled: number; failed: number;
  retries_known: number; retried: number; completed: number; apologetic: number;
}

const ratio = (n: number, d: number): number => (d > 0 ? n / d : 0);

/** Rates are 0 on an empty denominator (dashboard shape); the counts carry the denominators. */
export async function fetchSentiment(w: AnalyticsWindow): Promise<{ sentiment: AgentSentiment; memoryRecall: MemoryRecall }> {
  const [main, comments, recall] = await boundedAll<unknown[]>([
    () => runAnalytics<SentimentRow>(sentimentSql(w)),
    () => runAnalytics<{ session_id: string; rating: string; comment: string; completed_at: Date | null }>(sentimentCommentsSql(w)),
    () => runAnalytics<{ recalled: number; captured: boolean }>(memoryRecallSql(w)),
  ]);
  const r = (main as SentimentRow[])[0];
  const total = n0(r?.total_runs);
  const up = n0(r?.rating_up);
  const down = n0(r?.rating_down);
  const retriesKnown = n0(r?.retries_known);
  const completed = n0(r?.completed);
  const m = (recall as Array<{ recalled: number; captured: boolean }>)[0];
  const recalled = n0(m?.recalled);

  return {
    sentiment: {
      totalRuns: total,
      ratingUp: up,
      ratingDown: down,
      ratingTotal: up + down,
      ratingRatio: up + down > 0 ? up / (up + down) : null,
      cancelledRate: ratio(n0(r?.cancelled), total),
      failedRate: ratio(n0(r?.failed), total),
      retriedRate: ratio(n0(r?.retried), retriesKnown),
      retriesKnown,
      apologeticRate: ratio(n0(r?.apologetic), completed),
      recentComments: (comments as Array<{ session_id: string; rating: string; comment: string; completed_at: Date | null }>).map((c) => ({
        sessionId: c.session_id,
        rating: c.rating as "up" | "down",
        comment: c.comment.slice(0, 600),
        completedAt: c.completed_at ? new Date(c.completed_at).toISOString() : "",
      })),
    },
    memoryRecall: { recalled, runs: total, rate: rate(recalled, total), captured: m?.captured === true || recalled > 0 },
  };
}
