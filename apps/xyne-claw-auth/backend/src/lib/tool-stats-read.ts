/**
 * Read path over the precomputed `agent_runs.toolStats` column.
 *
 * These queries answer the same questions as the live blob-unnesting versions
 * in `tool-metrics.ts` / `tool-citations.ts`, but aggregate a ~760-byte inline
 * value instead of detoasting a ~15KB blob per run. Measured on 20k runs /
 * 240k invocations over a 7-day window: 57ms here versus 5,395ms for the
 * equivalent live queries.
 *
 * ── Where the numbers differ from the live path ───────────────────────────
 * Exact and identical: call, error, dropped-end, empty, citeable, cited,
 * duplicate and recovery counts; byte and duration totals; arg-field presence.
 * Each is a within-run property, so summing per-run values is lossless.
 *
 * Bucketed: p50/p95 come from a summed log-scale histogram, so they resolve to
 * a bucket edge rather than a millisecond. `avgMs` stays exact (sum ÷ count).
 *
 * Same-turn only: `citedCalls` counts tokens found in the answer of the run
 * that produced the call. The live `fetchToolCiteRates` remains the exact
 * conversation-scoped source for the cross-turn case.
 *
 * Coverage: runs finalised before this column existed have `toolStats` NULL and
 * are invisible here. `fetchToolStatsCoverage` reports that share so a caller
 * can show it rather than silently under-report; backfill closes the gap.
 */

import { Prisma } from "@prisma/client";
import { DURATION_BUCKETS_MS } from "./tool-stats.js";
import { windowPredicate, type AnalyticsWindow } from "./tool-metrics-sql.js";
// runAnalytics lives with the execution layer, not the SQL vocabulary — it is
// what applies the shared statement_timeout.
import { runAnalytics } from "./tool-metrics.js";

/** Guards the unnest — the column is a bare `Json?` with no shape constraint. */
const TOOLSTATS_IS_ARRAY = Prisma.sql`r."toolStats" IS NOT NULL AND jsonb_typeof(r."toolStats") = 'array'`;

export interface ToolStatsRow {
  tool: string;
  calls: number;
  /** Distinct runs that called this tool at all. */
  sessions: number;
  /**
   * calls ÷ sessions — how many times a run that uses this tool calls it.
   *
   * Separates "used by many runs once" from "hammered by a few runs", which the
   * raw call count cannot distinguish and which point at different problems: a
   * broad dependency versus a loop.
   */
  callsPerSession: number | null;
  topLevelCalls: number;
  childCalls: number;
  errors: number;
  errorRate: number;
  droppedEnd: number;
  droppedEndRate: number;
  emptyResults: number;
  emptyResultRate: number;
  duplicateCalls: number;
  duplicateRate: number;
  erroredCalls: number;
  recoveredCalls: number;
  recoveryRate: number;
  citeableCalls: number;
  citedCalls: number;
  /** citedCalls / citeableCalls, or null when nothing was citeable. Same-turn scope. */
  citeRate: number | null;
  avgMs: number | null;
  /** Bucket-resolution, not millisecond-resolution. */
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number;
  totalMs: number;
  resultBytesTotal: number;
  /** Share of all result bytes in the window, 0..1. */
  contextShare: number;
}

const rate = (n: number, d: number): number => (d > 0 ? n / d : 0);

/* ── Pagination ───────────────────────────────────────────────────────────
   A workspace can grant thousands of distinct tools, so the per-tool rollup
   is paged rather than returned whole. Sorting therefore has to happen in SQL:
   sorting a page client-side would rank 50 arbitrary rows and present the
   result as "the worst tools", which is worse than no sort at all. */

/** Sortable columns, mapped to SQL. A whitelist — never interpolate a caller's string. */
const TOOL_SORTS = {
  tool: Prisma.sql`j.tool`,
  calls: Prisma.sql`j.calls`,
  sessions: Prisma.sql`j.sessions`,
  callsPerSession: Prisma.sql`(j.calls::float8 / NULLIF(j.sessions, 0))`,
  errors: Prisma.sql`j.errors`,
  errorRate: Prisma.sql`(j.errors::float8 / NULLIF(j.calls, 0))`,
  duplicateRate: Prisma.sql`(j.duplicate_calls::float8 / NULLIF(j.calls, 0))`,
  droppedEnd: Prisma.sql`j.dropped_end`,
  emptyResults: Prisma.sql`j.empty_results`,
  recoveryRate: Prisma.sql`(j.recovered_calls::float8 / NULLIF(j.errors, 0))`,
  citeRate: Prisma.sql`(j.cited_calls::float8 / NULLIF(j.citeable_calls, 0))`,
  avgMs: Prisma.sql`(j.total_ms::float8 / NULLIF(j.timed, 0))`,
  // Bucket INDEX, not the edge value — the edges are monotonic, so ordering by
  // index is identical to ordering by the millisecond value it maps to.
  p50Ms: Prisma.sql`j.p50_idx`,
  p95Ms: Prisma.sql`j.p95_idx`,
  maxMs: Prisma.sql`j.max_ms`,
  totalMs: Prisma.sql`j.total_ms`,
  resultBytes: Prisma.sql`j.result_bytes`,
} as const;

export type ToolSortKey = keyof typeof TOOL_SORTS;

export const TOOL_SORT_KEYS = Object.keys(TOOL_SORTS) as ToolSortKey[];

export interface PageRequest {
  limit: number;
  offset: number;
  sort: ToolSortKey;
  dir: "asc" | "desc";
  /** Case-insensitive substring match on the tool name. */
  search?: string | undefined;
}

export interface PageInfo {
  limit: number;
  offset: number;
  /** Rows matching the search, across the whole window — not the page length. */
  total: number;
  sort: ToolSortKey;
  dir: "asc" | "desc";
}

/**
 * Window-wide sums for the KPI row.
 *
 * Computed in SQL over EVERY tool, never derived from the page: summing a page
 * would make "total tool calls" shrink as the reader moves through the table.
 * Unaffected by `search` for the same reason — the tiles describe the window.
 */
export interface ToolWindowTotals {
  distinctTools: number;
  /** Distinct runs that made at least one tool call in the window. */
  sessions: number;
  calls: number;
  errors: number;
  droppedEnd: number;
  duplicateCalls: number;
  emptyResults: number;
  citeableCalls: number;
  citedCalls: number;
  recoveredCalls: number;
  resultBytes: number;
  totalMs: number;
}

/**
 * A chart series computed over the WHOLE window, independent of the page.
 *
 * Ranked SERVER-SIDE per (measure, aggregation) rather than returning one
 * series the client re-sorts: the top 8 by cumulative bytes and the top 8 by
 * bytes-per-call are different sets, so re-ranking a fixed top-8 would silently
 * answer a different question than the one on screen.
 */
export interface ToolChartPoint {
  tool: string;
  value: number;
  /**
   * Share of the window total. Only meaningful for a `total` aggregation —
   * null otherwise, because an average is not a share of anything.
   */
  share: number | null;
  /** Sample size behind the value, so a thin average is visible as thin. */
  calls: number;
  sessions: number;
}

export type ChartMeasure = "bytes" | "time" | "errors" | "calls";
export type ChartAggregation = "total" | "perCall" | "perSession";

export interface ChartRequest {
  measure: ChartMeasure;
  aggregation: ChartAggregation;
}

/**
 * What each (measure, aggregation) pair plots.
 *
 * Duration divides by TIMED calls, not all calls — a call whose end event never
 * arrived has no duration and would drag a mean toward zero. Byte and error
 * measures divide by all calls, where every call contributes.
 */
const CHART_VALUE: Record<ChartMeasure, Partial<Record<ChartAggregation, Prisma.Sql>>> = {
  bytes: {
    total: Prisma.sql`j.result_bytes::float8`,
    perCall: Prisma.sql`(j.result_bytes::float8 / NULLIF(j.calls, 0))`,
    perSession: Prisma.sql`(j.result_bytes::float8 / NULLIF(j.sessions, 0))`,
  },
  time: {
    total: Prisma.sql`j.total_ms::float8`,
    perCall: Prisma.sql`(j.total_ms::float8 / NULLIF(j.timed, 0))`,
    perSession: Prisma.sql`(j.total_ms::float8 / NULLIF(j.sessions, 0))`,
  },
  errors: {
    total: Prisma.sql`j.errors::float8`,
    perCall: Prisma.sql`(j.errors::float8 / NULLIF(j.calls, 0))`,
    perSession: Prisma.sql`(j.errors::float8 / NULLIF(j.sessions, 0))`,
  },
  calls: {
    total: Prisma.sql`j.calls::float8`,
    // No perCall: calls-per-call is 1 by definition. An API caller asking for it
    // is coerced to `total` and told so via the echoed chartRequest, rather than
    // being silently served a different measure.
    perSession: Prisma.sql`(j.calls::float8 / NULLIF(j.sessions, 0))`,
  },
};

/** Window total for a measure, used as the denominator of `share`. */
const CHART_WINDOW_TOTAL: Record<ChartMeasure, (t: ToolWindowTotals) => number> = {
  bytes: (t) => t.resultBytes,
  time: (t) => t.totalMs,
  errors: (t) => t.errors,
  calls: (t) => t.calls,
};

export interface ToolStatsPage {
  rows: ToolStatsRow[];
  page: PageInfo;
  totals: ToolWindowTotals;
  /** The single series matching the requested measure and aggregation. */
  chart: ToolChartPoint[];
  chartRequest: ChartRequest;
}

const CHART_TOP_N = 8;

interface RawToolRow {
  tool: string | null;
  calls: number;
  sessions: number;
  top_level_calls: number;
  errors: number;
  dropped_end: number;
  empty_results: number;
  duplicate_calls: number;
  recovered_calls: number;
  citeable_calls: number;
  cited_calls: number;
  total_ms: number;
  max_ms: number;
  result_bytes: number;
  timed: number;
  p50_idx: number | null;
  p95_idx: number | null;
}

/** Bucket index (1-based, from WITH ORDINALITY) → the millisecond edge it means. */
function edgeFromIndex(idx: number | null): number | null {
  if (idx === null) return null;
  const i = Math.min(Math.max(idx - 1, 0), DURATION_BUCKETS_MS.length - 1);
  return DURATION_BUCKETS_MS[i] ?? null;
}

/**
 * The whole per-tool rollup in one pass over the summary column.
 *
 * Replaces `fetchToolSignals` + `fetchToolQuality` + `fetchToolCiteRates`
 * (2,395 + 1,177 + 3,000 ms) with a single query.
 *
 * Returns one row containing the page, the match count and the window totals,
 * so paging never costs a second scan of the window.
 */
export async function fetchToolStats(
  w: AnalyticsWindow,
  page: PageRequest,
  chart: ChartRequest = { measure: "bytes", aggregation: "total" },
): Promise<ToolStatsPage> {
  const sortExpr = TOOL_SORTS[page.sort] ?? TOOL_SORTS.calls;
  // Coerce a pair that has no meaning, and report the pair actually used — the
  // caller's labels have to describe the bars, not the request.
  const resolvedChart: ChartRequest = CHART_VALUE[chart.measure]?.[chart.aggregation]
    ? chart
    : { measure: chart.measure, aggregation: "total" };
  const chartValue = CHART_VALUE[resolvedChart.measure]?.[resolvedChart.aggregation]
    ?? CHART_VALUE.bytes.total!;
  const dir = page.dir === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  const search = page.search?.trim();
  // NULLS LAST in both directions: an unknown latency is never "the worst".
  // `j.tool` breaks ties so paging is stable — without it two rows with equal
  // call counts can swap between pages and one is seen twice, the other never.
  const orderBy = Prisma.sql`ORDER BY ${sortExpr} ${dir} NULLS LAST, j.tool ASC`;
  const searchPredicate = search
    ? Prisma.sql`WHERE j.tool ILIKE ${`%${search}%`}`
    : Prisma.empty;

  const [result] = await runAnalytics<{
    rows: RawToolRow[] | null;
    match_count: number;
    totals: ToolWindowTotals | null;
    chart: Array<{ tool: string; value: number; calls: number; sessions: number }> | null;
  }>(Prisma.sql`
    WITH stat AS (
      SELECT s AS v, r."sessionId" AS session_id
      FROM "agent_runs" r, LATERAL jsonb_array_elements(r."toolStats") s
      WHERE ${windowPredicate(w)}
        AND ${TOOLSTATS_IS_ARRAY}
    ), agg AS (
      SELECT
        v->>'t'                    AS tool,
        sum((v->>'c')::bigint)     AS calls,
        -- One toolStats entry per (run, tool), so a distinct count of runs is
        -- exactly "how many sessions used this tool".
        count(DISTINCT session_id) AS sessions,
        sum((v->>'tl')::bigint)    AS top_level_calls,
        sum((v->>'e')::bigint)     AS errors,
        sum((v->>'d')::bigint)     AS dropped_end,
        sum((v->>'z')::bigint)     AS empty_results,
        sum((v->>'dup')::bigint)   AS duplicate_calls,
        sum((v->>'rec')::bigint)   AS recovered_calls,
        sum((v->>'ce')::bigint)    AS citeable_calls,
        sum((v->>'ci')::bigint)    AS cited_calls,
        sum((v->>'ms')::bigint)    AS total_ms,
        max((v->>'mx')::bigint)    AS max_ms,
        sum((v->>'b')::bigint)     AS result_bytes
      FROM stat
      WHERE v->>'t' IS NOT NULL
      GROUP BY 1
    ), per_bucket AS (
      -- Grouped once rather than correlated per tool: a subquery keyed on the
      -- outer tool would re-scan the stat CTE once per group.
      -- The CASE is required, not defensive: a LATERAL set-returning function
      -- is evaluated before WHERE, so a missing or non-array histogram would
      -- abort the statement rather than skip the row.
      SELECT
        v->>'t'                  AS tool,
        idx,
        sum(cnt::bigint)::int    AS bucket_sum
      FROM stat,
           LATERAL jsonb_array_elements_text(
             CASE WHEN jsonb_typeof(v->'h') = 'array' THEN v->'h' ELSE '[]'::jsonb END
           ) WITH ORDINALITY b(cnt, idx)
      WHERE v->>'t' IS NOT NULL
      GROUP BY 1, 2
    ), pct AS (
      -- Percentiles from the summed histogram, in SQL rather than in TS, so the
      -- table can be ORDERed by them. Same walk as percentileFromBuckets: the
      -- first bucket whose running total reaches the target share.
      SELECT
        tool,
        max(tot)                                        AS timed,
        min(idx) FILTER (WHERE cum >= 0.50 * tot)       AS p50_idx,
        min(idx) FILTER (WHERE cum >= 0.95 * tot)       AS p95_idx
      FROM (
        SELECT
          tool, idx,
          sum(bucket_sum) OVER (PARTITION BY tool ORDER BY idx) AS cum,
          sum(bucket_sum) OVER (PARTITION BY tool)              AS tot
        FROM per_bucket
      ) walked
      WHERE tot > 0
      GROUP BY tool
    ), j AS (
      SELECT
        agg.*,
        COALESCE(pct.timed, 0) AS timed,
        pct.p50_idx,
        pct.p95_idx
      FROM agg LEFT JOIN pct ON pct.tool = agg.tool
    ), matched AS (
      SELECT * FROM j ${searchPredicate}
    )
    SELECT
      COALESCE((
        SELECT json_agg(pageRow)
        FROM (SELECT * FROM matched j ${orderBy} LIMIT ${page.limit} OFFSET ${page.offset}) pageRow
      ), '[]'::json) AS rows,
      (SELECT count(*) FROM matched)::int AS match_count,
      COALESCE((
        SELECT json_agg(x) FROM (
          SELECT j.tool, ${chartValue} AS value, j.calls::int AS calls, j.sessions::int AS sessions
          FROM j
          WHERE ${chartValue} IS NOT NULL AND ${chartValue} > 0
          ORDER BY ${chartValue} DESC, j.tool ASC
          LIMIT ${CHART_TOP_N}
        ) x
      ), '[]'::json) AS chart,
      (
        SELECT json_build_object(
          'distinctTools', count(*)::int,
          'calls',         COALESCE(sum(calls), 0)::int,
          'sessions',      (SELECT count(DISTINCT session_id) FROM stat)::int,
          'errors',        COALESCE(sum(errors), 0)::int,
          'droppedEnd',    COALESCE(sum(dropped_end), 0)::int,
          'duplicateCalls',COALESCE(sum(duplicate_calls), 0)::int,
          'emptyResults',  COALESCE(sum(empty_results), 0)::int,
          'citeableCalls', COALESCE(sum(citeable_calls), 0)::int,
          'citedCalls',    COALESCE(sum(cited_calls), 0)::int,
          'recoveredCalls',COALESCE(sum(recovered_calls), 0)::int,
          'resultBytes',   COALESCE(sum(result_bytes), 0)::bigint,
          'totalMs',       COALESCE(sum(total_ms), 0)::bigint
        ) FROM agg
      ) AS totals
  `);

  const totals: ToolWindowTotals = result?.totals ?? {
    distinctTools: 0, sessions: 0, calls: 0, errors: 0, droppedEnd: 0, duplicateCalls: 0,
    emptyResults: 0, citeableCalls: 0, citedCalls: 0, recoveredCalls: 0,
    resultBytes: 0, totalMs: 0,
  };
  // Share of the WHOLE window, not of the page — otherwise the same tool would
  // report a different context share depending on which page it landed on.
  const windowBytes = Number(totals.resultBytes);

  const rows = (result?.rows ?? []).map((r): ToolStatsRow => {
    const calls = Number(r.calls);
    const errors = Number(r.errors);
    const citeable = Number(r.citeable_calls);
    const cited = Number(r.cited_calls);
    const totalMs = Number(r.total_ms);
    const bytes = Number(r.result_bytes);
    const timed = Number(r.timed);
    const sessions = Number(r.sessions);
    return {
      tool: r.tool ?? "(unknown)",
      calls,
      sessions,
      callsPerSession: sessions > 0 ? calls / sessions : null,
      topLevelCalls: Number(r.top_level_calls),
      childCalls: calls - Number(r.top_level_calls),
      errors,
      errorRate: rate(errors, calls),
      droppedEnd: Number(r.dropped_end),
      droppedEndRate: rate(Number(r.dropped_end), calls),
      emptyResults: Number(r.empty_results),
      emptyResultRate: rate(Number(r.empty_results), calls),
      duplicateCalls: Number(r.duplicate_calls),
      duplicateRate: rate(Number(r.duplicate_calls), calls),
      erroredCalls: errors,
      recoveredCalls: Number(r.recovered_calls),
      recoveryRate: rate(Number(r.recovered_calls), errors),
      citeableCalls: citeable,
      citedCalls: cited,
      citeRate: citeable > 0 ? cited / citeable : null,
      avgMs: timed > 0 ? Math.round(totalMs / timed) : null,
      p50Ms: edgeFromIndex(r.p50_idx),
      p95Ms: edgeFromIndex(r.p95_idx),
      maxMs: Number(r.max_ms),
      totalMs,
      resultBytesTotal: bytes,
      contextShare: rate(bytes, windowBytes),
    };
  });

  const windowTotal = CHART_WINDOW_TOTAL[resolvedChart.measure](totals);
  const chartPoints: ToolChartPoint[] = (result?.chart ?? []).map((pt) => ({
    tool: pt.tool,
    value: Number(pt.value),
    // A share only means something for a total; an average is not a share.
    share: resolvedChart.aggregation === "total" ? rate(Number(pt.value), windowTotal) : null,
    calls: Number(pt.calls),
    sessions: Number(pt.sessions),
  }));

  return {
    rows,
    chart: chartPoints,
    chartRequest: resolvedChart,
    page: {
      limit: page.limit,
      offset: page.offset,
      total: Number(result?.match_count ?? 0),
      sort: page.sort,
      dir: page.dir,
    },
    totals: {
      distinctTools: Number(totals.distinctTools),
      sessions: Number(totals.sessions),
      calls: Number(totals.calls),
      errors: Number(totals.errors),
      droppedEnd: Number(totals.droppedEnd),
      duplicateCalls: Number(totals.duplicateCalls),
      emptyResults: Number(totals.emptyResults),
      citeableCalls: Number(totals.citeableCalls),
      citedCalls: Number(totals.citedCalls),
      recoveredCalls: Number(totals.recoveredCalls),
      resultBytes: windowBytes,
      totalMs: Number(totals.totalMs),
    },
  };
}

export interface ToolFieldUsageRow {
  tool: string;
  calls: number;
  field: string;
  callsWithField: number;
  supplyRate: number;
}

/** Per-tool argument field presence, from the precomputed `f` map. */
export async function fetchToolFieldUsage(w: AnalyticsWindow, limit = 400): Promise<ToolFieldUsageRow[]> {
  const rows = await runAnalytics<{
    tool: string;
    calls: bigint;
    field: string;
    calls_with_field: bigint;
  }>(Prisma.sql`
    WITH stat AS (
      SELECT s AS v
      FROM "agent_runs" r, LATERAL jsonb_array_elements(r."toolStats") s
      WHERE ${windowPredicate(w)}
        AND ${TOOLSTATS_IS_ARRAY}
    ), totals AS (
      SELECT v->>'t' AS tool, sum((v->>'c')::bigint) AS calls
      FROM stat WHERE v->>'t' IS NOT NULL GROUP BY 1
    )
    SELECT
      t.tool,
      t.calls,
      kv.key                        AS field,
      sum(kv.value::text::bigint)   AS calls_with_field
    FROM stat
         JOIN totals t ON t.tool = stat.v->>'t',
         LATERAL jsonb_each(CASE WHEN jsonb_typeof(stat.v->'f') = 'object' THEN stat.v->'f' ELSE '{}'::jsonb END) kv
    GROUP BY t.tool, t.calls, kv.key
    ORDER BY t.calls DESC, calls_with_field DESC
    LIMIT ${limit}
  `);

  return rows.map((r) => {
    const calls = Number(r.calls);
    const withField = Number(r.calls_with_field);
    return {
      tool: r.tool,
      calls,
      field: r.field,
      callsWithField: withField,
      supplyRate: rate(withField, calls),
    };
  });
}

export interface ToolStatsCoverage {
  runsInWindow: number;
  runsSummarised: number;
  /** 0..1. Below 1 means backfill has not finished; the shortfall is invisible to the fast path. */
  coverage: number;
}

/**
 * How much of the window the precomputed path can actually see.
 *
 * Surfacing this is not optional: a partially backfilled window makes every
 * count above look low, and without this number that reads as a real decline
 * rather than missing data.
 */
export async function fetchToolStatsCoverage(w: AnalyticsWindow): Promise<ToolStatsCoverage> {
  const [row] = await runAnalytics<{ runs: bigint; summarised: bigint }>(Prisma.sql`
    SELECT
      count(*)                                                        AS runs,
      count(*) FILTER (WHERE r."toolStats" IS NOT NULL)                AS summarised
    FROM "agent_runs" r
    WHERE ${windowPredicate(w)}
      AND r."toolInvocations" IS NOT NULL
  `);
  const runs = Number(row?.runs ?? 0);
  const summarised = Number(row?.summarised ?? 0);
  return { runsInWindow: runs, runsSummarised: summarised, coverage: rate(summarised, runs) };
}

export { DURATION_BUCKETS_MS };
