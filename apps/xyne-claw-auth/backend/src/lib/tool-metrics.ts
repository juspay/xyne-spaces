/**
 * Deep per-tool-call analytics over the EXISTING `agent_runs.toolInvocations`
 * JSONB column. No new table, no new column, no change to the agent hot path —
 * every signal here is derived from data claw already persists.
 *
 * ── Cost model (why the queries look the way they do) ─────────────────────
 * `toolInvocations` is a large TOASTed JSONB array (tens of KB per run). On a
 * 7-day window the row scan itself costs ~4ms while detoasting the blob costs
 * ~1000ms — i.e. >99% of the runtime, and no btree index avoids it. Two
 * consequences drive the design:
 *
 *   1. Unnest ONCE. Every query below shapes itself as a single
 *      `WITH inv AS MATERIALIZED (...)` CTE that pays the detoast a single
 *      time, then runs all of its aggregates off that materialised set.
 *      Splitting the same signals into N queries multiplies the dominant cost
 *      by N.
 *   2. Pick the window column that an existing index can serve. Per-agent
 *      queries filter on `startedAt` (served by the existing
 *      `@@index([agentSlug, startedAt])` as an exact two-column index cond);
 *      global queries filter on `completedAt` (served by
 *      `@@index([completedAt, triggerSource])`). Mixing them forces a BitmapAnd
 *      or a seq scan.
 *
 * Every query also runs under a LOCAL `statement_timeout` (see `runAnalytics`).
 * This database is shared with the live agent run path, so an analytics query
 * over an unexpectedly large window must fail fast rather than hold buffers.
 *
 * ── Where the shape guards live ───────────────────────────────────────────
 * The predicates these queries compose (dropped-end exclusion, top-level
 * filtering, args type coercion) are defined and documented in
 * `tool-metrics-sql.ts`, which imports no database client so they stay unit
 * testable. They are re-exported here for callers that build their own
 * queries.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import {
  invocationsCte,
  ERROR_CLASS,
  NOT_DROPPED_END,
  RESULT_TEXT,
  type AnalyticsWindow,
} from "./tool-metrics-sql.js";

/** Ceiling for any analytics query. Shared DB with the live run path. */
const ANALYTICS_TIMEOUT_MS = 15_000;

export {
  INVOCATIONS_IS_ARRAY,
  NOT_DROPPED_END,
  RESULT_TEXT,
  CLF_TOKEN_RE,
  CLF_CAPTURE_RE,
  ERROR_CLASS,
  windowPredicate,
  invocationsCte,
  type WindowColumn,
  type AnalyticsWindow,
} from "./tool-metrics-sql.js";

/**
 * Run an analytics query under a LOCAL statement timeout so a pathological
 * window cannot hold buffers on the database the live run path writes to.
 * `SET LOCAL` takes no bind parameters, hence the interpolated constant.
 */
export async function runAnalytics<T>(query: Prisma.Sql): Promise<T[]> {
  const [, rows] = await prisma.$transaction([
    prisma.$executeRawUnsafe(`SET LOCAL statement_timeout = ${ANALYTICS_TIMEOUT_MS}`),
    prisma.$queryRaw<T[]>(query),
  ]);
  return rows;
}

const num = (v: bigint | number | null): number => (v == null ? 0 : Number(v));
const round = (v: number | null): number | null => (v == null ? null : Math.round(v));
const rate = (n: number, d: number): number => (d > 0 ? n / d : 0);

export interface ToolErrorClassRow {
  tool: string;
  errorClass: string;
  occurrences: number;
  sample: string;
  lastSeen: string | null;
}

/**
 * Top failure modes per tool. Groups errored results by a normalised class so
 * the same failure with different ids collapses into one row — this answers
 * "why is this tool failing" with a GROUP BY rather than an LLM judge.
 */
export interface ToolFailurePage {
  rows: ToolErrorClassRow[];
  /** Distinct failure classes for this tool in the window — not the page length. */
  total: number;
  /** Every errored call for this tool, across all classes. */
  occurrences: number;
}

/**
 * EVERY failure class for one tool, paged.
 *
 * `fetchToolErrorClasses` deliberately keeps only the top few classes per tool
 * so the overview card stays readable. That cap hides the long tail, which is
 * exactly where a rare-but-fatal failure lives, so this is the drill-down: one
 * tool, no rank cap, ordered by frequency and paged.
 *
 * Still reads the live blob rather than `toolStats` — grouping failures needs
 * the raw error text, which no fixed-shape summary can carry. Bounded by the
 * window predicate and the shared statement timeout, same as the overview.
 */
export async function fetchToolFailures(
  w: AnalyticsWindow,
  tool: string,
  page: { limit: number; offset: number },
): Promise<ToolFailurePage> {
  const [result] = await runAnalytics<{
    rows: Array<{ error_class: string | null; occurrences: number; sample: string | null; last_seen: Date | null }> | null;
    total: number;
    occurrences: number;
  }>(Prisma.sql`
    ${invocationsCte(w)}
    , errored AS (
      SELECT
        ${ERROR_CLASS}                    AS error_class,
        left(${RESULT_TEXT}, 400)         AS sample,
        NULLIF(v->>'startedAt', '')::timestamptz AS started_at
      FROM inv
      WHERE v->>'isError' = 'true'
        AND ${NOT_DROPPED_END}
        AND v->>'toolName' = ${tool}
    ), grouped AS (
      SELECT
        error_class,
        count(*)::int   AS occurrences,
        min(sample)     AS sample,
        max(started_at) AS last_seen
      FROM errored
      GROUP BY error_class
    )
    SELECT
      COALESCE((
        SELECT json_agg(g)
        FROM (
          SELECT * FROM grouped
          ORDER BY occurrences DESC, error_class ASC
          LIMIT ${page.limit} OFFSET ${page.offset}
        ) g
      ), '[]'::json) AS rows,
      (SELECT count(*) FROM grouped)::int              AS total,
      (SELECT COALESCE(sum(occurrences), 0) FROM grouped)::int AS occurrences
  `);

  return {
    rows: (result?.rows ?? []).map((r) => ({
      tool,
      errorClass: r.error_class ?? "(unclassified)",
      occurrences: num(r.occurrences),
      sample: r.sample ?? "",
      lastSeen: r.last_seen ? new Date(r.last_seen).toISOString() : null,
    })),
    total: Number(result?.total ?? 0),
    occurrences: Number(result?.occurrences ?? 0),
  };
}

export async function fetchToolErrorClasses(w: AnalyticsWindow, limitPerTool = 5): Promise<ToolErrorClassRow[]> {
  const rows = await runAnalytics<{
    tool: string | null;
    error_class: string | null;
    occurrences: bigint;
    sample: string | null;
    last_seen: Date | null;
  }>(Prisma.sql`
    ${invocationsCte(w)}
    , errored AS (
      SELECT
        v->>'toolName'                    AS tool,
        ${ERROR_CLASS}                    AS error_class,
        left(${RESULT_TEXT}, 400)         AS sample,
        NULLIF(v->>'startedAt', '')::timestamptz AS started_at
      FROM inv
      WHERE v->>'isError' = 'true'
        AND ${NOT_DROPPED_END}
        AND v->>'toolName' IS NOT NULL
    ), grouped AS (
      SELECT
        tool,
        error_class,
        count(*)          AS occurrences,
        min(sample)       AS sample,
        max(started_at)   AS last_seen,
        row_number() OVER (PARTITION BY tool ORDER BY count(*) DESC) AS rn
      FROM errored
      GROUP BY tool, error_class
    )
    SELECT tool, error_class, occurrences, sample, last_seen
    FROM grouped
    WHERE rn <= ${limitPerTool}
    ORDER BY occurrences DESC
  `);

  return rows.map((r) => ({
    tool: r.tool ?? "(unknown)",
    errorClass: r.error_class ?? "(unclassified)",
    occurrences: num(r.occurrences),
    sample: r.sample ?? "",
    lastSeen: r.last_seen ? r.last_seen.toISOString() : null,
  }));
}
