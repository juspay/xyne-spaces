/**
 * Read path over `agent_run_stats.llmCalls`, the per-LLM-call series written at
 * finalize (shape owned by xyne-claw/src/llm-turn-stats.ts).
 *
 * Context size is `in + cr + cw` (cached tokens are reported separately).
 * Compaction resets the prompt, fallback can swap the model mid-run, and a
 * retried call's TTFT includes the abandoned attempt. Throughput is weighted
 * (Σ output tokens ÷ Σ decode seconds): a mean of per-call ratios lets one tiny
 * fast decode dominate the window.
 *
 * Cost: ONE unnest of the window with GROUPING SETS feeds every block; run
 * counts come from a hashed DISTINCT beside it. Bench levers: work_mem 64 MB
 * (the 4 MB default spills on every re-sort), percentiles FILTERed to in-scope
 * calls, narrow per-call rows, and `llmCallCount IS NOT NULL` so runs without a
 * series are not unnested. A MATERIALIZED CTE feeding both aggregates lost: a
 * CTE scan runs without parallel workers. No jsonb_typeof guard: it made the
 * planner underestimate rows ~200x.
 */

import { Prisma } from "@prisma/client";
import { rate, runAnalytics, statsWindowPredicate, windowPredicate, type AnalyticsWindow } from "./metrics-core.js";

export interface LlmSummary {
  calls: number;
  runs: number;
  nTtft: number;
  p50TtftMs: number | null;
  p95TtftMs: number | null;
  nDecode: number;
  p50DecodeMs: number | null;
  tokensPerSec: number | null;
  avgContextTokens: number | null;
  avgOutputTokens: number | null;
  cacheHitRate: number | null;
  compactions: number;
  retries: number;
  /** Counted whatever the scope, so a parent-only reader sees what they are not looking at. */
  subagentCalls: number;
  errorStops: number;
}

export interface LlmBucketRow {
  contextBucket: number;
  calls: number;
  nTtft: number;
  p50TtftMs: number | null;
  p95TtftMs: number | null;
  tokensPerSec: number | null;
  avgOutputTokens: number | null;
}

export interface LlmIndexRow {
  callIndex: number;
  calls: number;
  nTtft: number;
  p50TtftMs: number | null;
  p95TtftMs: number | null;
  avgContextTokens: number | null;
  tokensPerSec: number | null;
  compactionShare: number | null;
  retriedShare: number | null;
}

export interface LlmModelRow {
  model: string | null;
  provider: string | null;
  calls: number;
  runs: number;
  nTtft: number;
  p50TtftMs: number | null;
  p95TtftMs: number | null;
  tokensPerSec: number | null;
  avgContextTokens: number | null;
  avgOutputTokens: number | null;
  errorStops: number;
  retries: number;
}

export interface LlmCoverage {
  runsInWindow: number;
  runsWithSeries: number;
  coverage: number | null;
  /** ISO completedAt of the earliest run with a series; older runs cannot be backfilled. */
  seriesSince: string | null;
}

export interface LlmCallsResult {
  coverage: LlmCoverage;
  summary: LlmSummary;
  byContext: LlmBucketRow[];
  byCallIndex: LlmIndexRow[];
  byModel: LlmModelRow[];
}

/** Past this the tail is a handful of very long runs and reads as a trend that is not one. */
const MAX_CALL_INDEX = 40;
const MAX_MODEL_ROWS = 50;
const LLM_WORK_MEM_MB = 64;

const HAS_SERIES = Prisma.raw(`s."llmCallCount" IS NOT NULL`);

/** GROUPING(in_scope, model, provider, ctx_b, idx_b) bitmask per set: 1 = column is not a key of the set. */
const SET = { scope: 15, model: 3, context: 13, index: 14 } as const;

const inScopeSql = (includeSubagents: boolean): Prisma.Sql => Prisma.raw(includeSubagents ? "true" : "(c->>'sa' IS NULL)");

/**
 * The single unnest. Out-of-scope calls are kept so the scope set can count
 * them; percentiles FILTER them out. Retried calls get a NULL context key and
 * calls past MAX_CALL_INDEX a NULL index key: both land in a dropped NULL group.
 */
export function llmCallsSql(w: AnalyticsWindow, includeSubagents: boolean): Prisma.Sql {
  const inScope = inScopeSql(includeSubagents);
  return Prisma.sql`
    SELECT
      GROUPING(in_scope, model, provider, ctx_b, idx_b)                                   AS set_id,
      in_scope, model, provider, ctx_b, idx_b,
      count(*)                                                                            AS calls,
      count(ttft_ms)                                                                      AS n_ttft,
      percentile_cont(0.5)  WITHIN GROUP (ORDER BY ttft_ms) FILTER (WHERE in_scope)       AS p50_ttft,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY ttft_ms) FILTER (WHERE in_scope)       AS p95_ttft,
      count(*) FILTER (WHERE ttft_ms IS NOT NULL)                                         AS n_decode,
      percentile_cont(0.5)  WITHIN GROUP (ORDER BY decode_ms) FILTER (WHERE in_scope AND ttft_ms IS NOT NULL) AS p50_decode,
      sum(out_tokens) FILTER (WHERE decode_ms > 0 AND out_tokens > 0)                     AS tps_out,
      sum(decode_ms)  FILTER (WHERE decode_ms > 0 AND out_tokens > 0)                     AS tps_decode_ms,
      avg(ctx_tokens)                                                                     AS avg_ctx,
      avg(out_tokens)                                                                     AS avg_out,
      sum(cr_tokens)                                                                      AS cache_read,
      sum(ctx_tokens)                                                                     AS ctx_total,
      count(*) FILTER (WHERE compacted)                                                   AS compactions,
      count(*) FILTER (WHERE retried)                                                     AS retries,
      count(*) FILTER (WHERE subagent)                                                    AS subagent_calls,
      count(*) FILTER (WHERE error_stop)                                                  AS error_stops
    FROM (
      SELECT
        base.*,
        CASE
          WHEN retried THEN NULL
          WHEN ctx_tokens <   4000 THEN 0
          WHEN ctx_tokens <   8000 THEN 4000
          WHEN ctx_tokens <  16000 THEN 8000
          WHEN ctx_tokens <  32000 THEN 16000
          WHEN ctx_tokens <  64000 THEN 32000
          WHEN ctx_tokens < 128000 THEN 64000
          WHEN ctx_tokens < 256000 THEN 128000
          ELSE 256000
        END                                                  AS ctx_b,
        CASE WHEN call_i <= ${MAX_CALL_INDEX} THEN call_i END AS idx_b
      FROM (
        SELECT
          ${inScope}                                         AS in_scope,
          c->>'m'                                            AS model,
          c->>'p'                                            AS provider,
          (c->>'i')::int                                     AS call_i,
          NULLIF(c->>'ttft', '')::float8                     AS ttft_ms,
          COALESCE((c->>'dec')::float8, 0)                   AS decode_ms,
          COALESCE((c->>'out')::float8, 0)                   AS out_tokens,
          COALESCE((c->>'cr')::float8, 0)                    AS cr_tokens,
          COALESCE((c->>'in')::float8, 0) + COALESCE((c->>'cr')::float8, 0) + COALESCE((c->>'cw')::float8, 0) AS ctx_tokens,
          COALESCE((c->>'cmp')::boolean, false)              AS compacted,
          COALESCE((c->>'rty')::boolean, false)              AS retried,
          (c->>'sa' IS NOT NULL)                             AS subagent,
          COALESCE(c->>'sr' = 'error', false)                AS error_stop
        FROM "agent_run_stats" s
        CROSS JOIN LATERAL jsonb_array_elements(s."llmCalls") c
        WHERE ${statsWindowPredicate(w)}
          AND ${HAS_SERIES}
      ) base
    ) calls
    GROUP BY GROUPING SETS ((in_scope), (in_scope, model, provider), (in_scope, ctx_b), (in_scope, idx_b))
  `;
}

/** Run counts per scope and model, kept out of llmCallsSql: a count(DISTINCT) there sorts every call once per group. */
export function llmRunsSql(w: AnalyticsWindow, includeSubagents: boolean): Prisma.Sql {
  const inScope = inScopeSql(includeSubagents);
  return Prisma.sql`
    SELECT
      GROUPING(in_scope, model, provider)       AS set_id,
      in_scope, model, provider,
      count(*)                                  AS runs_model,
      count(*) FILTER (WHERE first_of_scope)    AS runs_scope
    FROM (
      SELECT per_model.*, row_number() OVER (PARTITION BY id, in_scope) = 1 AS first_of_scope
      FROM (
        SELECT DISTINCT s."runId" AS id, ${inScope} AS in_scope, c->>'m' AS model, c->>'p' AS provider
        FROM "agent_run_stats" s
        CROSS JOIN LATERAL jsonb_array_elements(s."llmCalls") c
        WHERE ${statsWindowPredicate(w)}
          AND ${HAS_SERIES}
      ) per_model
    ) per_run
    GROUP BY GROUPING SETS ((in_scope, model, provider), (in_scope))
  `;
}

/** Window coverage from the two covering indexes alone. */
export function llmCoverageSql(w: AnalyticsWindow): Prisma.Sql {
  return Prisma.sql`
    SELECT
      (SELECT count(*) FROM "agent_runs" r WHERE ${windowPredicate(w)})::int AS runs_in_window,
      count(s."llmCallCount")::int                                          AS runs_with_series,
      min(s."completedAt") FILTER (WHERE ${HAS_SERIES})                     AS series_since
    FROM "agent_run_stats" s
    WHERE ${statsWindowPredicate(w)}
  `;
}

/** GROUPING(in_scope, model, provider) per set of llmRunsSql. */
const RUN_SET = { model: 0, scope: 3 } as const;

interface RawRunsRow { set_id: number; in_scope: boolean | null; model: string | null; provider: string | null; runs_model: bigint; runs_scope: bigint }
interface RawCoverageRow { runs_in_window: number; runs_with_series: number; series_since: Date | string | null }

interface RawSetRow {
  set_id: number;
  in_scope: boolean | null;
  model: string | null;
  provider: string | null;
  ctx_b: number | null;
  idx_b: number | null;
  calls: bigint; n_ttft: bigint; n_decode: bigint;
  p50_ttft: number | null; p95_ttft: number | null; p50_decode: number | null;
  tps_out: number | null; tps_decode_ms: number | null;
  avg_ctx: number | null; avg_out: number | null; cache_read: number | null; ctx_total: number | null;
  compactions: bigint; retries: bigint; subagent_calls: bigint; error_stops: bigint;
}

const n = (v: bigint | number | null | undefined): number => (v == null ? 0 : Number(v));
const round = (v: number | null | undefined): number | null => (v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v)));

const weightedTps = (r: RawSetRow | undefined): number | null => {
  const decodeMs = r?.tps_decode_ms == null ? 0 : Number(r.tps_decode_ms);
  return decodeMs > 0 ? Math.round(Number(r?.tps_out ?? 0) / (decodeMs / 1000)) : null;
};

const isoOrNull = (v: Date | string | null | undefined): string | null => {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** Pure mapping of the grouping-set rows. */
export function shapeLlmCalls(raw: RawSetRow[], runsRaw: RawRunsRow[], cov: RawCoverageRow | undefined): LlmCallsResult {
  const setId = (r: { set_id: number }): number => Number(r.set_id);
  const setRows = (set: number) => raw.filter((r) => setId(r) === set && inScope(r));
  const scopeRows = raw.filter((r) => setId(r) === SET.scope);
  const scoped = scopeRows.find((r) => r.in_scope === true);
  const inScope = (r: { in_scope: boolean | null }): boolean => r.in_scope === true;
  const modelKey = (m: string | null, p: string | null): string => `${m ?? ""}\u0000${p ?? ""}\u0000${m === null ? 1 : 0}${p === null ? 1 : 0}`;
  const runsByModel = new Map(runsRaw.filter((r) => setId(r) === RUN_SET.model && inScope(r)).map((r) => [modelKey(r.model, r.provider), n(r.runs_model)]));
  const scopedRuns = n(runsRaw.find((r) => setId(r) === RUN_SET.scope && inScope(r))?.runs_scope);
  const runsInWindow = n(cov?.runs_in_window);
  const runsWithSeries = n(cov?.runs_with_series);

  const summary: LlmSummary = {
    calls: n(scoped?.calls),
    runs: scopedRuns,
    nTtft: n(scoped?.n_ttft),
    p50TtftMs: round(scoped?.p50_ttft),
    p95TtftMs: round(scoped?.p95_ttft),
    nDecode: n(scoped?.n_decode),
    p50DecodeMs: round(scoped?.p50_decode),
    tokensPerSec: weightedTps(scoped),
    avgContextTokens: round(scoped?.avg_ctx),
    avgOutputTokens: round(scoped?.avg_out),
    cacheHitRate: rate(Number(scoped?.cache_read ?? 0), Number(scoped?.ctx_total ?? 0)),
    compactions: n(scoped?.compactions),
    retries: n(scoped?.retries),
    subagentCalls: scopeRows.reduce((sum, r) => sum + n(r.subagent_calls), 0),
    errorStops: n(scoped?.error_stops),
  };

  const byContext = setRows(SET.context)
    .filter((r) => r.ctx_b !== null)
    .map((r): LlmBucketRow => ({
      contextBucket: Number(r.ctx_b),
      calls: n(r.calls),
      nTtft: n(r.n_ttft),
      p50TtftMs: round(r.p50_ttft),
      p95TtftMs: round(r.p95_ttft),
      tokensPerSec: weightedTps(r),
      avgOutputTokens: round(r.avg_out),
    }))
    .sort((a, b) => a.contextBucket - b.contextBucket);

  const byCallIndex = setRows(SET.index)
    .filter((r) => r.idx_b !== null)
    .map((r): LlmIndexRow => {
      const calls = n(r.calls);
      return {
        callIndex: Number(r.idx_b),
        calls,
        nTtft: n(r.n_ttft),
        p50TtftMs: round(r.p50_ttft),
        p95TtftMs: round(r.p95_ttft),
        avgContextTokens: round(r.avg_ctx),
        tokensPerSec: weightedTps(r),
        compactionShare: rate(n(r.compactions), calls),
        retriedShare: rate(n(r.retries), calls),
      };
    })
    .sort((a, b) => a.callIndex - b.callIndex);

  const byModel = setRows(SET.model)
    .map((r): LlmModelRow => ({
      model: r.model,
      provider: r.provider,
      calls: n(r.calls),
      runs: runsByModel.get(modelKey(r.model, r.provider)) ?? 0,
      nTtft: n(r.n_ttft),
      p50TtftMs: round(r.p50_ttft),
      p95TtftMs: round(r.p95_ttft),
      tokensPerSec: weightedTps(r),
      avgContextTokens: round(r.avg_ctx),
      avgOutputTokens: round(r.avg_out),
      errorStops: n(r.error_stops),
      retries: n(r.retries),
    }))
    .sort((a, b) => b.calls - a.calls || (a.model ?? "￿").localeCompare(b.model ?? "￿") || (a.provider ?? "").localeCompare(b.provider ?? ""))
    .slice(0, MAX_MODEL_ROWS);

  return {
    coverage: { runsInWindow, runsWithSeries, coverage: rate(runsWithSeries, runsInWindow), seriesSince: isoOrNull(cov?.series_since) },
    summary,
    byContext,
    byCallIndex,
    byModel,
  };
}

/** Every LLM-tab block for a window, three statements in parallel. Coverage below 1 is permanent for older windows (no backfill). */
export async function fetchLlmCalls(w: AnalyticsWindow, opts: { includeSubagents: boolean }): Promise<LlmCallsResult> {
  const [raw, runsRaw, [cov]] = await Promise.all([
    runAnalytics<RawSetRow>(llmCallsSql(w, opts.includeSubagents), { workMemMb: LLM_WORK_MEM_MB }),
    runAnalytics<RawRunsRow>(llmRunsSql(w, opts.includeSubagents), { workMemMb: LLM_WORK_MEM_MB }),
    runAnalytics<RawCoverageRow>(llmCoverageSql(w)),
  ]);
  return shapeLlmCalls(raw, runsRaw, cov);
}
