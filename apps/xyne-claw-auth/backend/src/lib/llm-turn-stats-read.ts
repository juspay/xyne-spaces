/**
 * Read path over `agent_runs.llmTurnStats` — the per-LLM-call series.
 *
 * Two questions this exists to answer, neither of which the run-level columns
 * can: how TTFT moves with prompt size, and how throughput moves with position
 * in the agent loop. `agent_runs.ttftMs` holds only the FIRST turn's value and
 * `tokensPerSec` is one aggregate for the whole run.
 *
 * ── Reading the numbers honestly ──────────────────────────────────────────
 * Context size is `in + cr + cw`. Cached tokens are reported separately by the
 * provider, so `in` alone understates the prompt by the entire cached prefix —
 * on a long agentic run that is most of it.
 *
 * Compaction RESETS the prompt, so context against call index is a sawtooth,
 * not a ramp. `afterCompaction` marks the first call on a reset prompt; a
 * TTFT-vs-context correlation that ignores it is measuring two different
 * regimes at once. Provider fallback can also swap the model mid-run, so
 * `model` is carried per call — a step change at call 12 may be a different
 * model rather than a bigger prompt. Retried calls carry `retried` because
 * their TTFT includes the abandoned attempt.
 *
 * Subagent calls are tagged with `subagent`; parent-only analysis is a filter
 * on that being null, never a separate query.
 *
 * ── Cost ──────────────────────────────────────────────────────────────────
 * The column is a small inline array (tens of entries), so unnesting it is
 * nothing like unnesting `toolInvocations`. Queries still run through
 * `runAnalytics` for the shared statement timeout, since this database is
 * shared with the live run path.
 */

import { Prisma } from "@prisma/client";
import { runAnalytics } from "./tool-metrics.js";
import { windowPredicate, type AnalyticsWindow } from "./tool-metrics-sql.js";

/** Guards the unnest — the column is a bare `Json?` with no shape constraint. */
const LLM_STATS_IS_ARRAY = Prisma.sql`r."llmTurnStats" IS NOT NULL AND jsonb_typeof(r."llmTurnStats") = 'array'`;

export interface LlmCallPoint {
  sessionId: string;
  agentSlug: string;
  /** Call index within its own loop (parent, or the subagent's). */
  callIndex: number;
  ttftMs: number | null;
  decodeMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** input + cacheRead + cacheWrite — the real prompt size. */
  contextTokens: number;
  /** outputTokens per second of decode; null when nothing was timed. */
  tokensPerSec: number | null;
  stopReason: string | null;
  model: string | null;
  provider: string | null;
  /** First call after a compaction, i.e. running on a reset prompt. */
  afterCompaction: boolean;
  /** TTFT includes an abandoned attempt. */
  retried: boolean;
  /** Null for parent-loop calls. */
  subagent: string | null;
}

/**
 * The raw per-call series, one row per LLM call, for scatter/regression work.
 *
 * Bounded by `limit` because this is point data, not an aggregate — callers
 * plotting a window should scope by agent or narrow the window rather than
 * raise it far.
 */
export async function fetchLlmCallSeries(w: AnalyticsWindow, limit = 5000): Promise<LlmCallPoint[]> {
  const rows = await runAnalytics<{
    session_id: string;
    agent_slug: string;
    call_index: number;
    ttft_ms: number | null;
    decode_ms: number;
    in_tokens: number;
    out_tokens: number;
    cr_tokens: number;
    cw_tokens: number;
    stop_reason: string | null;
    model: string | null;
    provider: string | null;
    after_compaction: boolean;
    retried: boolean;
    subagent: string | null;
  }>(Prisma.sql`
    SELECT
      r."sessionId"                        AS session_id,
      r."agentSlug"                        AS agent_slug,
      (c->>'i')::int                       AS call_index,
      NULLIF(c->>'ttft', '')::int          AS ttft_ms,
      COALESCE((c->>'dec')::int, 0)        AS decode_ms,
      COALESCE((c->>'in')::int, 0)         AS in_tokens,
      COALESCE((c->>'out')::int, 0)        AS out_tokens,
      COALESCE((c->>'cr')::int, 0)         AS cr_tokens,
      COALESCE((c->>'cw')::int, 0)         AS cw_tokens,
      c->>'sr'                             AS stop_reason,
      c->>'m'                              AS model,
      c->>'p'                              AS provider,
      COALESCE((c->>'cmp')::boolean, false) AS after_compaction,
      COALESCE((c->>'rty')::boolean, false) AS retried,
      c->>'sa'                             AS subagent
    FROM "agent_runs" r, LATERAL jsonb_array_elements(r."llmTurnStats") c
    WHERE ${windowPredicate(w)}
      AND ${LLM_STATS_IS_ARRAY}
    ORDER BY r."startedAt" DESC, call_index ASC
    LIMIT ${limit}
  `);

  return rows.map((r) => {
    const ctx = r.in_tokens + r.cr_tokens + r.cw_tokens;
    return {
      sessionId: r.session_id,
      agentSlug: r.agent_slug,
      callIndex: r.call_index,
      ttftMs: r.ttft_ms,
      decodeMs: r.decode_ms,
      inputTokens: r.in_tokens,
      outputTokens: r.out_tokens,
      cacheReadTokens: r.cr_tokens,
      cacheWriteTokens: r.cw_tokens,
      contextTokens: ctx,
      tokensPerSec: r.decode_ms > 0 && r.out_tokens > 0 ? Math.round(r.out_tokens / (r.decode_ms / 1000)) : null,
      stopReason: r.stop_reason,
      model: r.model,
      provider: r.provider,
      afterCompaction: r.after_compaction,
      retried: r.retried,
      subagent: r.subagent,
    };
  });
}

export interface LlmCallBucketRow {
  /** Lower edge of the context-size bucket, in tokens. */
  contextBucket: number;
  calls: number;
  p50TtftMs: number | null;
  p95TtftMs: number | null;
  avgTokensPerSec: number | null;
  avgOutputTokens: number;
}

/**
 * TTFT and throughput bucketed by prompt size — the direct read on "does a
 * bigger context cost us latency".
 *
 * Excludes retried calls, whose TTFT includes an abandoned attempt and would
 * otherwise inflate the buckets they land in.
 */
export async function fetchLlmLatencyByContext(w: AnalyticsWindow, parentOnly = true): Promise<LlmCallBucketRow[]> {
  const subagentFilter = parentOnly ? Prisma.sql`AND c->>'sa' IS NULL` : Prisma.empty;
  const rows = await runAnalytics<{
    context_bucket: number;
    calls: bigint;
    p50_ttft: number | null;
    p95_ttft: number | null;
    avg_tps: number | null;
    avg_out: number | null;
  }>(Prisma.sql`
    WITH point AS (
      SELECT
        COALESCE((c->>'in')::int, 0) + COALESCE((c->>'cr')::int, 0) + COALESCE((c->>'cw')::int, 0) AS ctx,
        NULLIF(c->>'ttft', '')::int    AS ttft,
        COALESCE((c->>'dec')::int, 0)  AS dec,
        COALESCE((c->>'out')::int, 0)  AS out
      FROM "agent_runs" r, LATERAL jsonb_array_elements(r."llmTurnStats") c
      WHERE ${windowPredicate(w)}
        AND ${LLM_STATS_IS_ARRAY}
        AND COALESCE((c->>'rty')::boolean, false) = false
        ${subagentFilter}
    )
    SELECT
      CASE
        WHEN ctx <   4000 THEN 0
        WHEN ctx <   8000 THEN 4000
        WHEN ctx <  16000 THEN 8000
        WHEN ctx <  32000 THEN 16000
        WHEN ctx <  64000 THEN 32000
        WHEN ctx < 128000 THEN 64000
        WHEN ctx < 256000 THEN 128000
        ELSE 256000
      END                                                        AS context_bucket,
      count(*)                                                   AS calls,
      percentile_cont(0.5)  WITHIN GROUP (ORDER BY ttft)         AS p50_ttft,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY ttft)         AS p95_ttft,
      avg(CASE WHEN dec > 0 AND out > 0 THEN out / (dec / 1000.0) END) AS avg_tps,
      avg(out)                                                   AS avg_out
    FROM point
    GROUP BY 1
    ORDER BY 1
  `);

  return rows.map((r) => ({
    contextBucket: Number(r.context_bucket),
    calls: Number(r.calls),
    p50TtftMs: r.p50_ttft == null ? null : Math.round(r.p50_ttft),
    p95TtftMs: r.p95_ttft == null ? null : Math.round(r.p95_ttft),
    avgTokensPerSec: r.avg_tps == null ? null : Math.round(r.avg_tps),
    avgOutputTokens: r.avg_out == null ? 0 : Math.round(r.avg_out),
  }));
}

export interface LlmCallIndexRow {
  callIndex: number;
  calls: number;
  p50TtftMs: number | null;
  p95TtftMs: number | null;
  avgContextTokens: number;
  avgTokensPerSec: number | null;
  /** Share of calls at this index that ran on a freshly compacted prompt, 0..1. */
  compactionShare: number;
  /** Share that were retries, whose TTFT includes an abandoned attempt, 0..1.
   *  Reported rather than filtered here: at a given index a retry IS what
   *  happened, and hiding it would understate observed latency. */
  retriedShare: number;
}

/**
 * The same measures against position in the loop, which is where the sawtooth
 * shows up: context climbs with each turn until a compaction resets it, and
 * `compactionShare` is what makes that visible instead of looking like noise.
 *
 * Capped at `maxIndex` because the tail is a handful of very long runs and
 * would otherwise read as a trend.
 */
export async function fetchLlmLatencyByCallIndex(
  w: AnalyticsWindow,
  maxIndex = 40,
  parentOnly = true,
): Promise<LlmCallIndexRow[]> {
  const subagentFilter = parentOnly ? Prisma.sql`AND c->>'sa' IS NULL` : Prisma.empty;
  const rows = await runAnalytics<{
    call_index: number;
    calls: bigint;
    p50_ttft: number | null;
    p95_ttft: number | null;
    avg_ctx: number | null;
    avg_tps: number | null;
    compactions: bigint;
    retries: bigint;
  }>(Prisma.sql`
    SELECT
      (c->>'i')::int                                             AS call_index,
      count(*)                                                   AS calls,
      percentile_cont(0.5)  WITHIN GROUP (ORDER BY NULLIF(c->>'ttft', '')::int) AS p50_ttft,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY NULLIF(c->>'ttft', '')::int) AS p95_ttft,
      avg(COALESCE((c->>'in')::int, 0) + COALESCE((c->>'cr')::int, 0) + COALESCE((c->>'cw')::int, 0)) AS avg_ctx,
      avg(CASE WHEN COALESCE((c->>'dec')::int, 0) > 0 AND COALESCE((c->>'out')::int, 0) > 0
               THEN (c->>'out')::int / ((c->>'dec')::int / 1000.0) END)          AS avg_tps,
      count(*) FILTER (WHERE COALESCE((c->>'cmp')::boolean, false))              AS compactions,
      count(*) FILTER (WHERE COALESCE((c->>'rty')::boolean, false))              AS retries
    FROM "agent_runs" r, LATERAL jsonb_array_elements(r."llmTurnStats") c
    WHERE ${windowPredicate(w)}
      AND ${LLM_STATS_IS_ARRAY}
      AND (c->>'i')::int <= ${maxIndex}
      ${subagentFilter}
    GROUP BY 1
    ORDER BY 1
  `);

  return rows.map((r) => {
    const calls = Number(r.calls);
    return {
      callIndex: r.call_index,
      calls,
      p50TtftMs: r.p50_ttft == null ? null : Math.round(r.p50_ttft),
      p95TtftMs: r.p95_ttft == null ? null : Math.round(r.p95_ttft),
      avgContextTokens: r.avg_ctx == null ? 0 : Math.round(r.avg_ctx),
      avgTokensPerSec: r.avg_tps == null ? null : Math.round(r.avg_tps),
      compactionShare: calls > 0 ? Number(r.compactions) / calls : 0,
      retriedShare: calls > 0 ? Number(r.retries) / calls : 0,
    };
  });
}

export interface LlmStatsCoverage {
  runsInWindow: number;
  runsWithSeries: number;
  coverage: number;
}

/**
 * Share of runs carrying a series. There is no backfill for this column — the
 * per-call timing only exists while the run executes — so runs completed before
 * it shipped are permanently absent and callers must show that rather than
 * report a shrinking sample as a trend.
 */
export async function fetchLlmStatsCoverage(w: AnalyticsWindow): Promise<LlmStatsCoverage> {
  const [row] = await runAnalytics<{ runs: bigint; with_series: bigint }>(Prisma.sql`
    SELECT
      count(*)                                              AS runs,
      count(*) FILTER (WHERE r."llmTurnStats" IS NOT NULL)  AS with_series
    FROM "agent_runs" r
    WHERE ${windowPredicate(w)}
  `);
  const runs = Number(row?.runs ?? 0);
  const withSeries = Number(row?.with_series ?? 0);
  return { runsInWindow: runs, runsWithSeries: withSeries, coverage: runs > 0 ? withSeries / runs : 0 };
}
