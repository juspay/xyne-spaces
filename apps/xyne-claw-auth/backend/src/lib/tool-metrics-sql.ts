/**
 * SQL vocabulary for tool-call analytics over `agent_runs.toolInvocations`.
 *
 * Deliberately free of any database import so the predicates below can be unit
 * tested without instantiating a Prisma client. Execution lives in
 * `tool-metrics.ts`; this module only describes shape.
 *
 * ── Why these guards exist ────────────────────────────────────────────────
 * `toolInvocations` is a bare `Json?` with no shape constraint, written from a
 * streaming path that performs no validation. Each predicate here defends a
 * specific failure that is otherwise either a hard query abort or, worse, a
 * silently wrong number. They are exported and tested so every call site
 * composes the same definitions rather than re-deriving them inline.
 *
 * Every fragment assumes the runs table is aliased `r` and a single unnested
 * invocation is aliased `v`.
 *
 * Scope note: the per-tool aggregates that used to live here are now computed
 * at write time in `tool-stats.ts`, so only the fragments still needed by the
 * live text-analysis queries (error taxonomy, exact conversation-scoped
 * citation) remain. Two constraints that bit during that work and still apply
 * to anything added here: never use the `?` jsonb key-exists operator, which
 * Prisma's raw parser reads as a bind placeholder (test key absence with
 * `-> IS NULL`); and never use a backslash regex escape or a backtick, because
 * `Prisma.sql` is a tagged template reading COOKED strings — `\s` silently
 * collapses to a bare `s`, and a backtick terminates the literal.
 */

import { Prisma } from "@prisma/client";

/**
 * `LATERAL jsonb_array_elements` raises on a non-array value, which aborts the
 * whole statement rather than skipping the row.
 */
export const INVOCATIONS_IS_ARRAY = Prisma.sql`r."toolInvocations" IS NOT NULL AND jsonb_typeof(r."toolInvocations") = 'array'`;


/** Exact negation of {@link IS_DROPPED_END}. Required on every latency aggregate. */
export const NOT_DROPPED_END = Prisma.sql`(v->>'status' <> 'running' AND COALESCE(v->>'result', '') NOT LIKE '(no result%tool end event was not received)')`;




/**
 * `result` is always a JSON *string*, but its CONTENT is routinely not JSON
 * (bash output, spill notices), so it must be treated strictly as text — a
 * `::jsonb` cast anywhere on this field will fail at runtime.
 */
export const RESULT_TEXT = Prisma.sql`COALESCE(v->>'result', '')`;


/**
 * Matches an inline citation token, mirroring the runtime's own
 * `/\[clf-[^#\s[\]]+#\d+\]/i`. Against a tool result it means "this call
 * produced citeable output"; against `agent_runs.result` it means "the final
 * answer cited something".
 */
export const CLF_TOKEN_RE = String.raw`\[clf-[^#\s\[\]]+#[0-9]+\]`;

/** Captures the toolCallId out of an inline `[clf-<id>#n]` token. */
export const CLF_CAPTURE_RE = String.raw`\[clf-([^#\s\[\]]+)#[0-9]+\]`;

/**
 * Collapses volatile substrings (hex ids, digits, whitespace runs) so the same
 * failure with different ids groups as one mode. Applied only to errored rows,
 * bounding the regexp cost by error count rather than total calls.
 *
 * Whitespace uses the POSIX class `[[:space:]]` rather than `\s` on purpose.
 * `Prisma.sql` is a tagged template that reads the COOKED strings, in which
 * `\s` collapses to a bare `s` — the pattern silently became `s+` and replaced
 * every letter "s" in the message. Any regex added here must avoid backslash
 * escapes for the same reason, or be passed as a bind parameter.
 */
export const ERROR_CLASS = Prisma.sql`
  left(
    regexp_replace(
      regexp_replace(lower(${RESULT_TEXT}), '[0-9a-f]{8,}|[0-9]+', '#', 'g'),
      '[[:space:]]+', ' ', 'g'
    ),
    160
  )
`;

export type WindowColumn = "startedAt" | "completedAt";

export interface AnalyticsWindow {
  windowStart: Date;
  windowEnd: Date;
  /**
   * Not a free choice: `startedAt` for agent-scoped queries (served by
   * `@@index([agentSlug, startedAt])` as an exact two-column index cond),
   * `completedAt` for unscoped ones (served by
   * `@@index([completedAt, triggerSource])`). The other pairing degrades to a
   * BitmapAnd or a sequential scan.
   */
  windowColumn: WindowColumn;
  /**
   * Zero, one, or many agents. Empty/absent means workspace-wide. One slug
   * still emits an equality test rather than a one-element IN, so the existing
   * single-agent plan is unchanged.
   */
  agentSlugs?: readonly string[] | undefined;
  userFilter: Prisma.Sql;
  orgFilter: Prisma.Sql;
}

/**
 * Restricts to a set of agents.
 *
 * One slug emits `= $1`, several emit `IN ($1, $2, …)`. Both are served by
 * `@@index([agentSlug, startedAt])` — the IN form as a ScalarArrayOp index scan
 * — so widening the selection does not change the access path.
 */
export function agentPredicate(slugs: readonly string[] | undefined): Prisma.Sql {
  if (!slugs || slugs.length === 0) return Prisma.empty;
  if (slugs.length === 1) return Prisma.sql`AND r."agentSlug" = ${slugs[0]}`;
  return Prisma.sql`AND r."agentSlug" IN (${Prisma.join([...slugs])})`;
}

/**
 * Window + agent + scope predicate shared by every analytics query, so scoping
 * rules and the index-friendly window column cannot drift between them.
 */
export function windowPredicate(w: AnalyticsWindow): Prisma.Sql {
  const col = w.windowColumn === "startedAt" ? Prisma.sql`r."startedAt"` : Prisma.sql`r."completedAt"`;
  const agent = agentPredicate(w.agentSlugs);
  return Prisma.sql`${col} >= ${w.windowStart} AND ${col} < ${w.windowEnd} ${agent} ${w.userFilter} ${w.orgFilter}`;
}

/**
 * The single unnest every per-invocation query builds on.
 *
 * Detoasting `toolInvocations` dominates the cost of these queries by roughly
 * two orders of magnitude, so the CTE is MATERIALIZED: all aggregates read one
 * unnest instead of paying the detoast once per signal.
 *
 * Exposes each invocation as `v`, plus the run keys needed for per-session
 * grouping and the 1-based array position `pos`. `pos` is a valid temporal
 * index because `appendToolInvocation` replaces rows in place by `toolCallId`
 * rather than appending duplicates.
 */
export function invocationsCte(w: AnalyticsWindow): Prisma.Sql {
  return Prisma.sql`
    WITH inv AS MATERIALIZED (
      SELECT
        e.value                AS v,
        e.ordinality           AS pos,
        r."sessionId"          AS session_id,
        r."agentSlug"          AS agent_slug
      FROM "agent_runs" r,
           LATERAL jsonb_array_elements(r."toolInvocations") WITH ORDINALITY e(value, ordinality)
      WHERE ${windowPredicate(w)}
        AND ${INVOCATIONS_IS_ARRAY}
    )
  `;
}
