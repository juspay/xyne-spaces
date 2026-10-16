/**
 * Tool-call analytics behind /api/v1/metrics/tools*, plus the backfill that
 * writes `agent_run_stats` rows for runs finished before they existed.
 *
 * The per-tool rollup is one GROUP BY over the write-time summary
 * (`agent_run_tool_stats`, see lib/tool-stats.ts); ranking, sorting and paging
 * happen in TypeScript on the cached rows. Only the opt-in exact citation join
 * reads the large `toolInvocations` blob. Stats readers window the stats
 * tables directly (statsWindowPredicate), which hold no orphan-closed runs.
 *
 * Prisma.sql gotchas: never use the `?` jsonb operator (read as a bind
 * placeholder); `Prisma.sql` reads COOKED strings, so pass backslash regexes as
 * bind parameters; `count(*)`/`sum(int)` return bigint, so `Number()` them.
 */

import { Prisma } from "@prisma/client";
import { findUnusedGrants, getSubagentDefinition, resolveAgentToolsConfig, type AgentToolsConfig } from "xyne-claw-shared";
import { prisma } from "../db.js";
import { createLogger } from "../logger.js";
import { invalidateMetricsCache, rate, runAnalytics, statsWindowPredicate, windowPredicate, type AnalyticsWindow } from "./metrics-core.js";
import {
  HISTOGRAM_SLOTS,
  percentileFromBuckets,
  persistRunStats,
  summarizeRun,
  type RunStatsItem,
  type RunToolSummary,
} from "./tool-stats.js";

const log = createLogger("tool-analytics");

/* Fragments for the raw-blob read: runs table aliased `r`, one unnested invocation `v`. */

/**
 * Excludes both dropped `tool_execution_end` shapes (a `running` row, and the
 * swept sentinel result). The sentinel is a wildcard because its em dash is
 * encoding-fragile; durationMs is never consulted (an instant tool reports 0);
 * a missing `status` counts as finished, as in lib/tool-stats.ts.
 */
export const NOT_DROPPED_END = Prisma.sql`(COALESCE(v->>'status', '') <> 'running' AND COALESCE(v->>'result', '') NOT LIKE '(no result%tool end event was not received)')`;

/** `result` content is routinely not JSON, so it is read strictly as text. */
export const RESULT_TEXT = Prisma.sql`COALESCE(v->>'result', '')`;

/** An inline citation token; always bound so its backslashes survive. */
export const CLF_TOKEN_RE = String.raw`\[clf-[^#\s\[\]]+#[0-9]+\]`;

/** Captures the toolCallId out of an inline `[clf-<id>#n]` token. */
export const CLF_CAPTURE_RE = String.raw`\[clf-([^#\s\[\]]+)#[0-9]+\]`;

const num = (v: bigint | number | null | undefined): number => (v == null ? 0 : Number(v));

/** A request the caller should fix (HTTP 400). */
export class MetricsBadRequestError extends Error {
  readonly status = 400;
}

export interface ToolRow {
  tool: string;
  calls: number;
  /** Runs the tool appeared in. */
  runs: number;
  topLevelCalls: number;
  childCalls: number;
  errors: number;
  errorRate: number | null;
  /** Errored calls that were "Tool X not found" (palette misses). Included in errors. */
  notFound: number;
  dropped: number;
  droppedRate: number | null;
  empty: number;
  emptyRate: number | null;
  duplicates: number;
  duplicateRate: number | null;
  recovered: number;
  /** recovered / errors; null without errors. */
  recoveryRate: number | null;
  unrecovered: number;
  citeable: number;
  cited: number;
  /** cited / citeable, same-turn scope; null when nothing was citeable. */
  citeRate: number | null;
  /** Calls with a recorded duration (the n behind avg and percentiles). */
  timedCalls: number;
  avgMs: number | null;
  /** Estimated from duration buckets; null when the percentile falls in the overflow bucket. */
  p50Ms: number | null;
  p95Ms: number | null;
  /** p95 is above the last bucket edge; show "> edge" or maxMs, never the edge. */
  p95Overflow: boolean;
  maxMs: number;
  totalMs: number;
  bytes: number;
  avgBytes: number | null;
  /** Share of all result bytes in the window. */
  contextShare: number | null;
  /** Run counts per signal: the denominators a drill-down list reconciles with. */
  sessions: { errored: number; recovered: number; unrecovered: number; dropped: number; duplicated: number; empty: number; cited: number };
}

export interface ToolTotals {
  distinctTools: number;
  calls: number;
  errors: number;
  notFound: number;
  dropped: number;
  duplicates: number;
  empty: number;
  recovered: number;
  citeable: number;
  cited: number;
  bytes: number;
  totalMs: number;
  timedCalls: number;
  avgMsPerCall: number | null;
  runsWithTools: number;
}

export interface RankPoint {
  tool: string;
  calls: number;
  value: number;
  share: number | null;
  avg: number | null;
  errorRate: number | null;
  p95Ms: number | null;
}

export interface RankSet {
  byTotal: RankPoint[];
  byAvg: RankPoint[];
  other: { tools: number; value: number; share: number | null };
}

export interface ToolRollup {
  totals: ToolTotals;
  rows: ToolRow[];
  ranking: {
    time: RankSet;
    bytes: RankSet;
    errors: { byCount: RankPoint[]; byRate: RankPoint[]; other: { tools: number; value: number; share: number | null } };
  };
}

const RANK_TOP_N = 8;
const RANK_MIN_CALLS_AVG = 5;
/** Matches SAMPLE_FLOORS.toolRateRow. */
const RANK_MIN_CALLS_RATE = 10;

interface RawRollupRow {
  tool: string | null;
  runs: bigint | number;
  c: bigint | null; tl: bigint | null; e: bigint | null; nf: bigint | null; d: bigint | null; z: bigint | null;
  dup: bigint | null; rec: bigint | null; ce: bigint | null; ci: bigint | null; ms: bigint | null; mx: bigint | null; b: bigint | null;
  s_err: bigint | number; s_rec: bigint | number; s_unrec: bigint | number; s_drop: bigint | number;
  s_dup: bigint | number; s_empty: bigint | number; s_cited: bigint | number;
  [slot: `h${number}`]: bigint | null;
}

/** Sum of each duration bucket (Postgres arrays are 1-based). */
const HISTOGRAM_SUMS = Prisma.raw(
  Array.from({ length: HISTOGRAM_SLOTS }, (_, i) => `sum(t."durationBuckets"[${i + 1}]) AS h${i}`).join(",\n      "),
);

/** Exported so its shape is testable without a database. */
export function toolRollupSql(w: AnalyticsWindow): Prisma.Sql {
  return Prisma.sql`
    SELECT
      t."tool"               AS tool,
      count(*)               AS runs,
      sum(t."calls")         AS c,
      sum(t."topLevelCalls") AS tl,
      sum(t."errors")        AS e,
      sum(t."notFound")      AS nf,
      sum(t."dropped")       AS d,
      sum(t."empty")         AS z,
      sum(t."duplicates")    AS dup,
      sum(t."recovered")     AS rec,
      sum(t."citeable")      AS ce,
      sum(t."cited")         AS ci,
      sum(t."totalMs")       AS ms,
      max(t."maxMs")         AS mx,
      sum(t."resultBytes")   AS b,
      ${HISTOGRAM_SUMS},
      count(*) FILTER (WHERE t."errors" > 0)             AS s_err,
      count(*) FILTER (WHERE t."recovered" > 0)          AS s_rec,
      count(*) FILTER (WHERE t."errors" > t."recovered") AS s_unrec,
      count(*) FILTER (WHERE t."dropped" > 0)            AS s_drop,
      count(*) FILTER (WHERE t."duplicates" > 0)         AS s_dup,
      count(*) FILTER (WHERE t."empty" > 0)              AS s_empty,
      count(*) FILTER (WHERE t."cited" > 0)              AS s_cited
    FROM "agent_run_tool_stats" t
    WHERE ${statsWindowPredicate(w, "t")}
    GROUP BY 1
  `;
}

interface ToolScalars {
  runsInWindow: number;
  runsSummarised: number;
  runsWithTools: number;
}

/** Runs in the window (agent_runs), runs with a stats row, and runs with any tool call (agent_run_stats). */
async function fetchToolScalars(w: AnalyticsWindow): Promise<ToolScalars> {
  const [row] = await runAnalytics<{ runs: bigint; summarised: bigint; with_tools: bigint }>(Prisma.sql`
    SELECT
      (SELECT count(*) FROM "agent_runs" r WHERE ${windowPredicate(w)}) AS runs,
      count(*)                                    AS summarised,
      count(*) FILTER (WHERE s."toolCalls" > 0)   AS with_tools
    FROM "agent_run_stats" s
    WHERE ${statsWindowPredicate(w)}
  `);
  return {
    runsInWindow: num(row?.runs),
    runsSummarised: num(row?.summarised),
    runsWithTools: num(row?.with_tools),
  };
}

export interface ToolStatsCoverage {
  runsInWindow: number;
  runsSummarised: number;
  coverage: number | null;
}

/** How much of the window the stats can see; an un-backfilled window otherwise reads as a decline. */
export async function fetchToolStatsCoverage(w: AnalyticsWindow): Promise<ToolStatsCoverage> {
  const s = await fetchToolScalars(w);
  return { runsInWindow: s.runsInWindow, runsSummarised: s.runsSummarised, coverage: rate(s.runsSummarised, s.runsInWindow) };
}

function toToolRow(r: RawRollupRow, windowBytes: number): ToolRow {
  const calls = num(r.c);
  const errors = num(r.e);
  const dropped = num(r.d);
  const empty = num(r.z);
  const duplicates = num(r.dup);
  const recovered = num(r.rec);
  const citeable = num(r.ce);
  const cited = num(r.ci);
  const totalMs = num(r.ms);
  const bytes = num(r.b);
  const buckets = Array.from({ length: HISTOGRAM_SLOTS }, (_, i) => num(r[`h${i}`]));
  const timed = buckets.reduce((a, b) => a + b, 0);
  const p50 = percentileFromBuckets(buckets, 0.5);
  const p95 = percentileFromBuckets(buckets, 0.95);
  const measured = calls - dropped;
  return {
    tool: r.tool ?? "(unknown)",
    calls,
    runs: num(r.runs),
    topLevelCalls: num(r.tl),
    childCalls: calls - num(r.tl),
    errors,
    errorRate: rate(errors, calls),
    notFound: num(r.nf),
    dropped,
    droppedRate: rate(dropped, calls),
    empty,
    emptyRate: rate(empty, measured),
    duplicates,
    duplicateRate: rate(duplicates, calls),
    recovered,
    recoveryRate: rate(recovered, errors),
    unrecovered: Math.max(errors - recovered, 0),
    citeable,
    cited,
    citeRate: rate(cited, citeable),
    timedCalls: timed,
    avgMs: timed > 0 ? Math.round(totalMs / timed) : null,
    p50Ms: p50.ms,
    p95Ms: p95.ms,
    p95Overflow: p95.overflow,
    maxMs: num(r.mx),
    totalMs,
    bytes,
    avgBytes: measured > 0 ? Math.round(bytes / measured) : null,
    contextShare: rate(bytes, windowBytes),
    sessions: {
      errored: num(r.s_err),
      recovered: num(r.s_rec),
      unrecovered: num(r.s_unrec),
      dropped: num(r.s_drop),
      duplicated: num(r.s_dup),
      empty: num(r.s_empty),
      cited: num(r.s_cited),
    },
  };
}

const point = (row: ToolRow, value: number, total: number | null, avg: number | null): RankPoint => ({
  tool: row.tool,
  calls: row.calls,
  value,
  share: total === null ? null : rate(value, total),
  avg,
  errorRate: row.errorRate,
  p95Ms: row.p95Ms,
});

const byDesc = <T>(key: (x: T) => number | null) => (a: T & { tool: string }, b: T & { tool: string }): number =>
  (key(b) ?? -Infinity) - (key(a) ?? -Infinity) || a.tool.localeCompare(b.tool);

function rankSet(rows: ToolRow[], total: (r: ToolRow) => number, avg: (r: ToolRow) => number | null, minCalls: (r: ToolRow) => number): RankSet {
  const windowTotal = rows.reduce((n, r) => n + total(r), 0);
  const ranked = rows.filter((r) => total(r) > 0).sort(byDesc(total));
  const top = ranked.slice(0, RANK_TOP_N);
  const rest = ranked.slice(RANK_TOP_N);
  const restValue = rest.reduce((n, r) => n + total(r), 0);
  const avgRanked = rows
    .filter((r) => minCalls(r) >= RANK_MIN_CALLS_AVG && avg(r) !== null)
    .sort(byDesc(avg))
    .slice(0, RANK_TOP_N);
  return {
    byTotal: top.map((r) => point(r, total(r), windowTotal, avg(r))),
    byAvg: avgRanked.map((r) => point(r, avg(r) ?? 0, null, avg(r))),
    other: { tools: rest.length, value: restValue, share: rate(restValue, windowTotal) },
  };
}

/** Rankings over the whole window, never over a page. */
export function rankTools(rows: ToolRow[]): ToolRollup["ranking"] {
  const time = rankSet(rows, (r) => r.totalMs, (r) => r.avgMs, (r) => r.timedCalls);
  const bytes = rankSet(rows, (r) => r.bytes, (r) => r.avgBytes, (r) => r.calls - r.dropped);
  const errorTotal = rows.reduce((n, r) => n + r.errors, 0);
  const errored = rows.filter((r) => r.errors > 0).sort(byDesc((r) => r.errors));
  const rest = errored.slice(RANK_TOP_N);
  const restValue = rest.reduce((n, r) => n + r.errors, 0);
  return {
    time,
    bytes,
    errors: {
      byCount: errored.slice(0, RANK_TOP_N).map((r) => point(r, r.errors, errorTotal, r.errorRate)),
      byRate: rows
        .filter((r) => r.calls >= RANK_MIN_CALLS_RATE && r.errorRate !== null && r.errors > 0)
        .sort(byDesc((r) => r.errorRate))
        .slice(0, RANK_TOP_N)
        .map((r) => point(r, r.errorRate ?? 0, null, r.errorRate)),
      other: { tools: rest.length, value: restValue, share: rate(restValue, errorTotal) },
    },
  };
}

/** The per-tool picture for a window; callers cache it and page it with `pageToolRows`. */
export async function fetchToolRollup(w: AnalyticsWindow): Promise<ToolRollup> {
  const [raw, scalars] = await Promise.all([runAnalytics<RawRollupRow>(toolRollupSql(w)), fetchToolScalars(w)]);
  const windowBytes = raw.reduce((n, r) => n + num(r.b), 0);
  const rows = raw.map((r) => toToolRow(r, windowBytes)).sort((a, b) => b.calls - a.calls || a.tool.localeCompare(b.tool));

  const sum = (f: (r: ToolRow) => number): number => rows.reduce((n, r) => n + f(r), 0);
  const totalMs = sum((r) => r.totalMs);
  const timedCalls = sum((r) => r.timedCalls);
  const totals: ToolTotals = {
    distinctTools: rows.length,
    calls: sum((r) => r.calls),
    errors: sum((r) => r.errors),
    notFound: sum((r) => r.notFound),
    dropped: sum((r) => r.dropped),
    duplicates: sum((r) => r.duplicates),
    empty: sum((r) => r.empty),
    recovered: sum((r) => r.recovered),
    citeable: sum((r) => r.citeable),
    cited: sum((r) => r.cited),
    bytes: windowBytes,
    totalMs,
    timedCalls,
    avgMsPerCall: timedCalls > 0 ? Math.round(totalMs / timedCalls) : null,
    runsWithTools: scalars.runsWithTools,
  };
  return { totals, rows, ranking: rankTools(rows) };
}

export type ToolSortKey =
  | "tool" | "calls" | "errors" | "errorRate" | "recoveryRate" | "dropped" | "duplicates" | "duplicateRate" | "emptyRate"
  | "citeRate" | "uncited" | "avgMs" | "p95Ms" | "maxMs" | "totalMs" | "bytes" | "avgBytes";

/** Citeable results the same-turn answer did not cite: the impact behind a low cite rate. */
export const uncitedCount = (r: Pick<ToolRow, "citeable" | "cited">): number => Math.max(r.citeable - r.cited, 0);

const SORT_VALUE: Record<Exclude<ToolSortKey, "tool">, (r: ToolRow) => number | null> = {
  calls: (r) => r.calls,
  errors: (r) => r.errors,
  errorRate: (r) => r.errorRate,
  recoveryRate: (r) => r.recoveryRate,
  dropped: (r) => r.dropped,
  duplicates: (r) => r.duplicates,
  duplicateRate: (r) => r.duplicateRate,
  emptyRate: (r) => r.emptyRate,
  citeRate: (r) => r.citeRate,
  uncited: uncitedCount,
  avgMs: (r) => r.avgMs,
  // An overflow p95 is above every edge, so it sorts as the largest value.
  p95Ms: (r) => (r.p95Overflow ? Number.MAX_SAFE_INTEGER : r.p95Ms),
  maxMs: (r) => r.maxMs,
  totalMs: (r) => r.totalMs,
  bytes: (r) => r.bytes,
  avgBytes: (r) => r.avgBytes,
};

export const TOOL_SORT_KEYS: readonly ToolSortKey[] = ["tool", ...(Object.keys(SORT_VALUE) as ToolSortKey[])];

/** Search, sort and page the cached rows. Nulls sort last both ways; the tool name breaks ties so pages are stable. */
export function pageToolRows(
  rows: ToolRow[],
  req: { sort: ToolSortKey; dir: "asc" | "desc"; limit: number; offset: number; search?: string | undefined },
): { rows: ToolRow[]; total: number } {
  const needle = req.search?.trim().toLowerCase();
  const matched = needle ? rows.filter((r) => r.tool.toLowerCase().includes(needle)) : [...rows];
  const sign = req.dir === "asc" ? 1 : -1;
  if (req.sort === "tool") {
    matched.sort((a, b) => sign * a.tool.localeCompare(b.tool));
  } else {
    const value = SORT_VALUE[req.sort] ?? SORT_VALUE.calls;
    matched.sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      if (va === null && vb === null) return a.tool.localeCompare(b.tool);
      if (va === null) return 1;
      if (vb === null) return -1;
      return sign * (va - vb) || a.tool.localeCompare(b.tool);
    });
  }
  const offset = Math.max(0, req.offset);
  return { rows: matched.slice(offset, offset + Math.max(0, req.limit)), total: matched.length };
}

export interface ErrorClassRow {
  tool: string;
  errorClass: string;
  occurrences: number;
  /** Distinct runs that hit this class. */
  runs: number;
  sample: string;
  /** When the last run that hit this class finished. */
  lastSeen: string | null;
  notFound: boolean;
}

/**
 * Failure classes, most frequent first. `perTool` caps classes per tool; `tool`
 * narrows to one tool with no cap. `occurrences` counts every errored call in
 * scope, before the cap. A class appears once per tool row and there is one
 * tool row per run, so counting rows counts distinct runs.
 */
export async function fetchErrorClasses(
  w: AnalyticsWindow,
  opts: { tool?: string | undefined; limit: number; offset: number; perTool?: number | undefined },
): Promise<{ rows: ErrorClassRow[]; total: number; occurrences: number }> {
  const toolFilter = opts.tool ? Prisma.sql`AND t."tool" = ${opts.tool}` : Prisma.empty;
  const capFilter = opts.perTool && opts.perTool > 0 ? Prisma.sql`WHERE rn <= ${opts.perTool}` : Prisma.empty;
  const [result] = await runAnalytics<{
    rows: Array<{ tool: string; error_class: string; occ: number; runs: number; sample: string | null; last_seen_ms: number | null; nf: boolean }> | null;
    total: number;
    occurrences: number;
  }>(Prisma.sql`
    WITH g AS (
      SELECT
        t."tool"                                        AS tool,
        c->>'class'                                     AS error_class,
        sum((c->>'count')::int)::int                    AS occ,
        count(*)::int                                   AS runs,
        min(c->>'sample')                               AS sample,
        extract(epoch FROM max(t."completedAt")) * 1000 AS last_seen_ms,
        bool_or((c->>'notFound')::boolean)              AS nf
      FROM "agent_run_tool_stats" t
      CROSS JOIN LATERAL jsonb_array_elements(t."errorClasses") c
      WHERE ${statsWindowPredicate(w, "t")}
        AND t."errors" > 0
        ${toolFilter}
      GROUP BY 1, 2
    ), ranked AS (
      SELECT g.*, row_number() OVER (PARTITION BY tool ORDER BY occ DESC, error_class ASC) AS rn FROM g
    ), kept AS (
      SELECT * FROM ranked ${capFilter}
    )
    SELECT
      COALESCE((
        SELECT json_agg(k) FROM (
          SELECT tool, error_class, occ, runs, sample, last_seen_ms, nf FROM kept
          ORDER BY occ DESC, tool ASC, error_class ASC
          LIMIT ${opts.limit} OFFSET ${opts.offset}
        ) k
      ), '[]'::json)                                  AS rows,
      (SELECT count(*) FROM kept)::int                AS total,
      (SELECT COALESCE(sum(occ), 0) FROM g)::int      AS occurrences
  `);
  return {
    rows: (result?.rows ?? []).map((r) => ({
      tool: r.tool,
      errorClass: r.error_class,
      occurrences: num(r.occ),
      runs: num(r.runs),
      sample: r.sample ?? "",
      lastSeen: r.last_seen_ms == null ? null : new Date(Number(r.last_seen_ms)).toISOString(),
      notFound: r.nf === true,
    })),
    total: num(result?.total),
    occurrences: num(result?.occurrences),
  };
}

/* Citations: of the tool calls that could be cited, how many did the answer cite. A segmented
   diagnostic, never a cross-agent score: `citationReflection` re-prompts until the model cites,
   inflating the rate, so both agent flags are reported beside it. */

export interface ToolCiteRow {
  tool: string;
  calls: number;
  citeableCalls: number;
  citedCalls: number;
  citeRate: number | null;
}

/** Most runs the exact join may read (~1 to 3.4 s per 10k runs on the bench); compared with `/summary`'s `current.runs`. */
export const EXACT_CITATIONS_MAX_RUNS = 15_000;

const windowDays = (w: AnalyticsWindow): number => (w.windowEnd.getTime() - w.windowStart.getTime()) / 86_400_000;

/** The free part of the exact gate (an agent filter or at most 7 days), so a refusal costs no cached block. */
export function assertExactCitationsAllowed(w: AnalyticsWindow): void {
  if (!((w.agentSlugs?.length ?? 0) > 0 || windowDays(w) <= 7)) {
    throw new MetricsBadRequestError("exact citations need an agent filter or a window of 7 days or less");
  }
}

/**
 * Conversation-scoped cite rate per tool: a later turn re-citing an earlier
 * chunk counts. calls/citeable come from the tool rows; only `cited` reads
 * blobs, and only for citeable calls of runs whose conversation cites anything.
 * OFFSET 0 stops the planner flattening the lateral (flattened, the GROUP BY
 * sort spilled 111-135 MB); `jsonb_path_query(..., 'strict $[*]', '{}', true)`
 * yields nothing for a non-array instead of raising, detoasting the blob once.
 */
export function toolCiteRatesSql(w: AnalyticsWindow, limit = 100): Prisma.Sql {
  return Prisma.sql`
    WITH cited_ids AS (
      SELECT DISTINCT
        COALESCE(r."conversationId", r."sessionId")          AS convo,
        (regexp_matches(r."result", ${CLF_CAPTURE_RE}, 'g'))[1] AS tool_call_id
      FROM "agent_runs" r
      WHERE ${windowPredicate(w)}
        AND r."result" ~ ${CLF_TOKEN_RE}
    ), per_tool AS (
      SELECT
        t."tool"                                AS tool,
        sum(t."calls" - t."dropped")::bigint    AS calls,
        sum(t."citeable")::bigint               AS citeable_calls
      FROM "agent_run_tool_stats" t
      WHERE ${statsWindowPredicate(w, "t")}
      GROUP BY 1
      HAVING sum(t."calls" - t."dropped") > 0
    ), cited_runs AS MATERIALIZED (
      SELECT r."id", COALESCE(r."conversationId", r."sessionId") AS convo
      FROM "agent_runs" r
      JOIN "agent_run_stats" s ON s."runId" = r."id"
      -- Windowing the stats row too lets the planner use its index.
      WHERE ${windowPredicate(w)} AND ${statsWindowPredicate(w)} AND s."toolCalls" > 0
        AND COALESCE(r."conversationId", r."sessionId") IN (SELECT convo FROM cited_ids)
    ), cited AS (
      SELECT x.tool, count(*) AS cited_calls
      FROM cited_runs cr
      JOIN "agent_runs" r ON r."id" = cr."id"
      CROSS JOIN LATERAL (
        SELECT v->>'toolName' AS tool, v->>'toolCallId' AS call_id
        FROM jsonb_path_query(r."toolInvocations", 'strict $[*]', '{}', true) e(v)
        WHERE ${NOT_DROPPED_END}
          AND v->>'toolName' IS NOT NULL
          AND ${RESULT_TEXT} ~ ${CLF_TOKEN_RE}
        OFFSET 0
      ) x
      JOIN cited_ids c ON c.convo = cr.convo AND c.tool_call_id = x.call_id
      GROUP BY 1
    )
    SELECT p.tool AS tool, p.calls AS calls, p.citeable_calls AS citeable_calls, COALESCE(c.cited_calls, 0) AS cited_calls
    FROM per_tool p
    LEFT JOIN cited c ON c.tool = p.tool
    ORDER BY citeable_calls DESC, calls DESC, tool ASC
    LIMIT ${limit}
  `;
}

async function fetchToolCiteRates(w: AnalyticsWindow, limit = 100): Promise<ToolCiteRow[]> {
  const rows = await runAnalytics<{ tool: string | null; calls: bigint; citeable_calls: bigint; cited_calls: bigint }>(
    toolCiteRatesSql(w, limit),
    { timeoutMs: 15_000 },
  );
  return rows.map((r) => {
    const citeable = num(r.citeable_calls);
    const cited = num(r.cited_calls);
    return { tool: r.tool ?? "(unknown)", calls: num(r.calls), citeableCalls: citeable, citedCalls: cited, citeRate: rate(cited, citeable) };
  });
}

/** Finished runs in the window, for the exact-citation run cap. */
async function countWindowRuns(w: AnalyticsWindow): Promise<number> {
  const [row] = await runAnalytics<{ runs: number }>(Prisma.sql`
    SELECT count(*)::int AS runs FROM "agent_runs" r WHERE ${windowPredicate(w)}
  `);
  return num(row?.runs);
}

interface RunAgentKey { agent_slug: string; org_id: string }

const agentKey = (orgId: string, slug: string): string => `${orgId}\u0000${slug}`;

/** Agent rows for the (org, slug) pairs that ran; slugs are unique per org only, so never look up by slug alone. */
async function findRunAgents(pairs: readonly RunAgentKey[]): Promise<Map<string, { slug: string; orgId: string; config: Prisma.JsonValue; delegationTier: string }>> {
  if (pairs.length === 0) return new Map();
  const agents = await prisma.agent.findMany({
    where: { OR: pairs.map((p) => ({ orgId: p.org_id, slug: p.agent_slug })) },
    select: { slug: true, orgId: true, config: true, delegationTier: true },
  });
  return new Map(agents.map((a) => [agentKey(a.orgId, a.slug), a]));
}

async function fetchRunAgentPairs(w: AnalyticsWindow): Promise<RunAgentKey[]> {
  return runAnalytics<RunAgentKey>(Prisma.sql`
    SELECT DISTINCT r."agentSlug" AS agent_slug, r."orgId" AS org_id
    FROM "agent_runs" r
    WHERE ${windowPredicate(w)}
  `);
}

const flagOn = (config: unknown, key: string): boolean => {
  const value = (config as Record<string, unknown> | null)?.[key];
  return value === true || value === "true";
};

export interface CitationsResult {
  scope: "same-turn" | "conversation";
  funnel: { citeable: number; cited: number };
  reflection: Array<{ outcome: string; runs: number; share: number }>;
  flags: Array<{ orgId: string; agentSlug: string; autoToolCitations: boolean; citationReflection: boolean }>;
  exact: ToolCiteRow[] | null;
}

/**
 * Citation funnel (same-turn, from the summaries), reflection outcomes and
 * per-agent flags; `exact` adds the conversation-scoped per-tool join, allowed
 * only for an agent filter or at most 7 days and EXACT_CITATIONS_MAX_RUNS runs.
 * `rollup` (or a thunk, resolved only after the exact gate) supplies the funnel.
 */
export async function fetchCitations(
  w: AnalyticsWindow,
  opts: { exact: boolean; rollup?: ToolRollup | (() => Promise<ToolRollup>) | undefined },
): Promise<CitationsResult> {
  if (opts.exact) {
    assertExactCitationsAllowed(w);
    const runs = await countWindowRuns(w);
    if (runs > EXACT_CITATIONS_MAX_RUNS) {
      throw new MetricsBadRequestError(
        `exact citations read every run's tool calls and are limited to ${EXACT_CITATIONS_MAX_RUNS.toLocaleString("en-US")} runs; ` +
          `this window has ${runs.toLocaleString("en-US")}. Narrow the agent filter or the window.`,
      );
    }
  }
  const funnel = (): Promise<{ citeable: number; cited: number }> => {
    if (opts.rollup) {
      const r = opts.rollup;
      return (typeof r === "function" ? r() : Promise.resolve(r)).then((v) => ({ citeable: v.totals.citeable, cited: v.totals.cited }));
    }
    return runAnalytics<{ ce: bigint | null; ci: bigint | null }>(Prisma.sql`
        SELECT sum(t."citeable") AS ce, sum(t."cited") AS ci
        FROM "agent_run_tool_stats" t
        WHERE ${statsWindowPredicate(w, "t")}
      `).then(([row]) => ({ citeable: num(row?.ce), cited: num(row?.ci) }));
  };
  const reflection = (): Promise<Array<{ outcome: string | null; runs: bigint }>> => runAnalytics(Prisma.sql`
      SELECT s."citationOutcome" AS outcome, count(*) AS runs
      FROM "agent_run_stats" s
      WHERE ${statsWindowPredicate(w)}
        AND s."citationOutcome" IS NOT NULL
      GROUP BY 1
      ORDER BY runs DESC, outcome ASC
    `);

  // At most three statements in flight; the long exact join starts first.
  let funnelValue: { citeable: number; cited: number };
  let reflectionRows: Array<{ outcome: string | null; runs: bigint }>;
  let agents: Awaited<ReturnType<typeof findRunAgents>>;
  let exact: ToolCiteRow[] | null = null;
  if (opts.exact) {
    let pairs: RunAgentKey[];
    [exact, reflectionRows, pairs] = await Promise.all([fetchToolCiteRates(w), reflection(), fetchRunAgentPairs(w)]);
    [funnelValue, agents] = await Promise.all([funnel(), findRunAgents(pairs)]);
  } else {
    let pairs: RunAgentKey[];
    [funnelValue, reflectionRows, pairs] = await Promise.all([funnel(), reflection(), fetchRunAgentPairs(w)]);
    agents = await findRunAgents(pairs);
  }

  const reflectionTotal = reflectionRows.reduce((n, r) => n + num(r.runs), 0);
  return {
    scope: opts.exact ? "conversation" : "same-turn",
    funnel: funnelValue,
    reflection: reflectionRows.map((r) => ({
      outcome: r.outcome ?? "(unknown)",
      runs: num(r.runs),
      share: reflectionTotal > 0 ? num(r.runs) / reflectionTotal : 0,
    })),
    flags: [...agents.values()]
      .map((a) => ({
        orgId: a.orgId,
        agentSlug: a.slug,
        autoToolCitations: flagOn(a.config, "autoToolCitations"),
        citationReflection: flagOn(a.config, "citationReflection"),
      }))
      .sort((a, b) => a.agentSlug.localeCompare(b.agentSlug) || a.orgId.localeCompare(b.orgId)),
    exact,
  };
}

/** open-palette: `tools.openPalette` is read|all, so the agent may reach any tool and "granted" is not a fixed list. */
export type PaletteState = "scoped" | "open-palette" | "unscoped";

export interface AgentPaletteRow {
  orgId: string;
  agentSlug: string;
  state: PaletteState;
  openPalette?: "read" | "all";
  /** Distinct tools observed in the window (agent_run_stats.toolNames: toolsUsed ∪ called tools). */
  observedTools: number;
  /** Listed grants; null when the palette is unrestricted (or open with nothing pinned). */
  granted: number | null;
  used: number | null;
  unused: number | null;
  usedShare: number | null;
}

const GRANT_KINDS = ["subagents", "direct", "custom", "gateway"] as const satisfies ReadonlyArray<keyof AgentToolsConfig>;

/** The server a grant belongs to, so the Coverage tab can group unused grants. */
async function grantServers(grants: Array<{ kind: keyof AgentToolsConfig; grant: string }>): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const lookups = new Set<string>();
  for (const { kind, grant } of grants) {
    const key = `${kind}\u0000${grant}`;
    if (kind === "subagents") out.set(key, getSubagentDefinition(grant)?.serverType ?? grant);
    else if (kind === "gateway") out.set(key, grant);
    else if (grant.includes("__")) out.set(key, grant.slice(0, grant.indexOf("__")));
    else lookups.add(grant);
  }
  if (lookups.size > 0) {
    const names = [...lookups];
    // A bare grant is a custom slug or the tool part of an MCP slug (`<type>__<tool>`).
    const rows = await prisma.$queryRaw<Array<{ grant: string; source: string | null }>>(Prisma.sql`
      SELECT g AS "grant",
             (SELECT t.source FROM "tools" t
               WHERE t.slug = g OR right(t.slug, length(g) + 2) = '__' || g
               ORDER BY (t.slug = g) DESC LIMIT 1) AS source
      FROM unnest(${names}::text[]) AS g
    `);
    const sourceByGrant = new Map(rows.map((r) => [r.grant, r.source]));
    for (const { kind, grant } of grants) {
      const key = `${kind}\u0000${grant}`;
      if (out.has(key)) continue;
      const source = sourceByGrant.get(grant) ?? null;
      out.set(key, source ? (source.startsWith("mcp:") ? source.slice(4) : source) : null);
    }
  }
  return out;
}

/**
 * Grants that never produced a tool call in the window, per agent. Observed
 * tools are each stats row's `toolNames` (toolsUsed plus called tools; neither
 * alone is complete). The palette is the one a run enforces, except an open
 * palette is its own state: those agents can reach every tool.
 */
export async function fetchUnusedGrants(w: AnalyticsWindow): Promise<{
  agents: AgentPaletteRow[];
  unusedGrants: Array<{ orgId: string; agentSlug: string; kind: string; grant: string; server?: string | null }>;
}> {
  const observedRows = await runAnalytics<RunAgentKey & { observed: string[] | null }>(Prisma.sql`
    SELECT
      s."agentSlug" AS agent_slug,
      s."orgId"     AS org_id,
      array_agg(DISTINCT x.t) FILTER (WHERE x.t IS NOT NULL) AS observed
    FROM "agent_run_stats" s
    LEFT JOIN LATERAL unnest(s."toolNames") AS x(t) ON true
    WHERE ${statsWindowPredicate(w)}
    GROUP BY 1, 2
  `);
  if (observedRows.length === 0) return { agents: [], unusedGrants: [] };

  const agents = await findRunAgents(observedRows);
  const rows: AgentPaletteRow[] = [];
  const unused: Array<{ orgId: string; agentSlug: string; kind: keyof AgentToolsConfig; grant: string }> = [];

  for (const row of observedRows) {
    const agent = agents.get(agentKey(row.org_id, row.agent_slug));
    const observed = row.observed ?? [];
    const observedTools = new Set(observed).size;
    const cfg = agent ? resolveAgentToolsConfig(agent.config as Record<string, unknown> | null, agent.delegationTier) : undefined;
    if (!cfg) {
      rows.push({ orgId: row.org_id, agentSlug: row.agent_slug, state: "unscoped", observedTools, granted: null, used: null, unused: null, usedShare: null });
      continue;
    }
    const palette = (cfg as Record<string, unknown>)["openPalette"];
    const openPalette = palette === "read" || palette === "all" ? palette : undefined;
    const granted = GRANT_KINDS.reduce((n, kind) => n + (Array.isArray(cfg[kind]) ? cfg[kind]!.length : 0), 0);
    const agentUnused = findUnusedGrants(cfg, observed);
    for (const u of agentUnused) unused.push({ orgId: row.org_id, agentSlug: row.agent_slug, kind: u.kind, grant: u.grant });

    // An open palette with nothing pinned has no list to measure against.
    const measured = !openPalette || granted > 0;
    const unusedCount = agentUnused.length;
    rows.push({
      orgId: row.org_id,
      agentSlug: row.agent_slug,
      state: openPalette ? "open-palette" : "scoped",
      ...(openPalette ? { openPalette } : {}),
      observedTools,
      granted: measured ? granted : null,
      used: measured ? granted - unusedCount : null,
      unused: measured ? unusedCount : null,
      usedShare: measured ? rate(granted - unusedCount, granted) : null,
    });
  }

  rows.sort((a, b) => (b.unused ?? -1) - (a.unused ?? -1) || a.agentSlug.localeCompare(b.agentSlug) || a.orgId.localeCompare(b.orgId));
  const servers = await grantServers(unused);
  return {
    agents: rows,
    unusedGrants: unused.map((u) => ({ ...u, server: servers.get(`${u.kind}\u0000${u.grant}`) ?? null })),
  };
}

/* Backfill: finished runs without an agent_run_stats row are invisible to every read above. Rows go
   through the same summarizeRun + persistRunStats path as finalize. Walks agent_runs by primary key
   (the anti-join probes the stats PK), so a call resumes where the last stopped; `force` rewrites
   every row in range. */

export interface BackfillOptions {
  batchSize?: number;
  maxRows?: number;
  pauseMs?: number;
  /** Only runs completed at or after this instant. */
  since?: Date;
  /** Only runs completed before this instant. */
  until?: Date;
  /** Rewrite runs that already have a stats row too. */
  force?: boolean;
}

export interface BackfillReport {
  scanned: number;
  summarised: number;
  /** Runs written as an empty summary (no invocations, malformed, or failing on their data). */
  emptied: number;
  /** agent_run_tool_stats rows written. */
  toolRows: number;
  /** Runs whose write failed transiently; left without a row so the next call retries them. */
  failed: number;
  /** Errored tool calls recorded in those rows. */
  errorRows: number;
  batches: number;
  durationMs: number;
  /** Finished runs in range still without a stats row. */
  remaining: number;
}

const BACKFILL_DEFAULTS = { batchSize: 200, pauseMs: 50 } as const;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface BackfillRow {
  id: string; orgId: string; userId: string; agentSlug: string;
  completedAt: Date; error: string | null; result: string | null;
  toolInvocations: unknown; toolsUsed: string[] | null; citation_outcome: string | null;
}

const asTx = (tx: unknown): Prisma.TransactionClient => tx as Prisma.TransactionClient;

const EMPTY: RunToolSummary = { stats: [], totals: { calls: 0, errors: 0 }, errors: [] };

/**
 * A write failing on the run's own data (SQLSTATE class 22 or 23) fails on every
 * retry; anything else (timeout, pool, connection) may pass next call, so no
 * empty summary may be written for it.
 */
export function isDataWriteError(err: unknown): boolean {
  const code = (err as { meta?: { code?: unknown } } | null | undefined)?.meta?.code;
  return typeof code === "string" && /^2[23]/.test(code);
}

/** Finished, non-orphan runs in range; `missing` limits them to runs without a stats row. */
function backfillRangeSql(opts: BackfillOptions, missing: boolean): Prisma.Sql {
  return Prisma.sql`
    r."completedAt" IS NOT NULL
    ${opts.since ? Prisma.sql`AND r."completedAt" >= ${opts.since}` : Prisma.empty}
    ${opts.until ? Prisma.sql`AND r."completedAt" < ${opts.until}` : Prisma.empty}
    AND (r."error" IS NULL OR r."error" <> 'interrupted (orphaned run)')
    ${missing ? Prisma.sql`AND NOT EXISTS (SELECT 1 FROM "agent_run_stats" s WHERE s."runId" = r."id")` : Prisma.empty}
  `;
}

/**
 * Write a stats row for every finished run that lacks one (every run in range
 * with `force`), in primary-key order. A failed batch is retried row by row; a
 * row still failing on its own data is stored as an empty summary, any other
 * failure leaves it missing and counted in `failed`.
 */
export async function backfillToolStats(opts: BackfillOptions = {}): Promise<BackfillReport> {
  const batchSize = opts.batchSize ?? BACKFILL_DEFAULTS.batchSize;
  const pauseMs = opts.pauseMs ?? BACKFILL_DEFAULTS.pauseMs;
  const startedAt = Date.now();
  const report = { scanned: 0, summarised: 0, emptied: 0, toolRows: 0, failed: 0, errorRows: 0, batches: 0 };

  const persist = async (items: RunStatsItem[]): Promise<void> => {
    const written = await prisma.$transaction((tx) => persistRunStats(asTx(tx), items), { timeout: 60_000, maxWait: 10_000 });
    report.toolRows += written.toolRows;
    report.errorRows += written.errorCalls;
    for (const i of items) {
      if (i.summary.stats.length > 0) report.summarised += 1;
      else report.emptied += 1;
    }
  };

  const persistBatch = async (rows: BackfillRow[]): Promise<void> => {
    const items: RunStatsItem[] = rows.map((r) => {
      let summary: RunToolSummary;
      try {
        summary = summarizeRun(r.toolInvocations, r.result);
      } catch (err) {
        log.warn(`[backfill] run ${r.id} not summarisable: ${err instanceof Error ? err.message : String(err)}`);
        summary = EMPTY;
      }
      return {
        run: { id: r.id, orgId: r.orgId, userId: r.userId, agentSlug: r.agentSlug, completedAt: r.completedAt, error: r.error },
        summary,
        toolsUsed: r.toolsUsed,
        citationOutcome: r.citation_outcome,
      };
    });
    try {
      await persist(items);
    } catch (err) {
      log.warn(`[backfill] batch write failed, retrying per row: ${err instanceof Error ? err.message : String(err)}`);
      for (const item of items) {
        try {
          await persist([item]);
        } catch (rowErr) {
          const message = rowErr instanceof Error ? rowErr.message : String(rowErr);
          if (!isDataWriteError(rowErr)) {
            report.failed += 1;
            log.warn(`[backfill] run ${item.run.id} not written, left for the next call: ${message}`);
            continue;
          }
          log.warn(`[backfill] run ${item.run.id} failed on its data, stored as an empty summary: ${message}`);
          await persist([{ run: item.run, summary: EMPTY, toolsUsed: item.toolsUsed, citationOutcome: item.citationOutcome }]).catch(() => undefined);
        }
      }
    }
  };

  let cursor = "";
  for (;;) {
    const take = opts.maxRows === undefined ? batchSize : Math.min(batchSize, opts.maxRows - report.scanned);
    if (take <= 0) break;
    const rows = await prisma.$queryRaw<BackfillRow[]>(Prisma.sql`
      SELECT r."id", r."orgId", r."userId", r."agentSlug", r."completedAt",
             r."error", r."result", r."toolInvocations", r."toolsUsed",
             r."metadata"->'citationReflection'->>'outcome' AS citation_outcome
      FROM "agent_runs" r
      WHERE r."id" > ${cursor} AND ${backfillRangeSql(opts, !opts.force)}
      ORDER BY r."id"
      LIMIT ${take}
    `);
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1]!.id;
    report.batches += 1;
    report.scanned += rows.length;
    await persistBatch(rows);
    log.info(`[backfill] batch ${report.batches}: scanned=${report.scanned} summarised=${report.summarised} emptied=${report.emptied}`);
    if (rows.length < take) break;
    if (pauseMs > 0) await sleep(pauseMs);
  }

  const [left] = await prisma.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
    SELECT count(*) AS n FROM "agent_runs" r WHERE ${backfillRangeSql(opts, true)}
  `);
  if (report.scanned > 0) await invalidateMetricsCache();

  const result: BackfillReport = { ...report, durationMs: Date.now() - startedAt, remaining: num(left?.n) };
  log.info(`[backfill] done: ${JSON.stringify(result)}`);
  return result;
}
