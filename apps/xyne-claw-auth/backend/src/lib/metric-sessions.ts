/**
 * The sessions behind a metric: one implementation for the dashboard drill-down
 * (GET /metrics/sessions) and the agent tool find_metric_sessions, so a list
 * never disagrees with the tile it was opened from.
 *
 * Every kind uses the aggregates' window (`completedAt` plus the orphan
 * exclusion, via windowPredicate); tool kinds page over agent_run_tool_stats
 * like the tool rollup. Access paths:
 *   - tool: the (orgId, tool, completedAt) index, newest first. Plans are
 *     custom per request: the cached generic plan took a popular tool from 1-3 ms to 537 ms.
 *   - failed / slow: the covering window index, so the page of ids is index-only.
 *   - model: an ordered walk of the window.
 * Each query selects a page of ids in a MATERIALIZED CTE so the detail joins run
 * for one page only. Error samples come from the tool row's errorClasses, never
 * the TOASTed toolInvocations blob. Paging is keyset only: the window end moves,
 * so offset pages would drift.
 */

import { Prisma } from "@prisma/client";
import { WALL_MS, runAnalytics, statsWindowPredicate, windowPredicate, type AnalyticsWindow } from "./metrics-core.js";
import { MetricsBadRequestError, fetchToolStatsCoverage } from "./tool-analytics.js";

export type SessionKind = "tool" | "failed" | "slow" | "model";
export type ToolSignal = "calls" | "errors" | "recovered" | "unrecovered" | "dropped" | "duplicates" | "empty" | "cited" | "notFound";

export const SESSION_KINDS: readonly SessionKind[] = ["tool", "failed", "slow", "model"];

/** Signal → tool-row condition (alias t = agent_run_tool_stats). */
export const SIGNAL_CONDITIONS: Readonly<Record<ToolSignal, string>> = {
  calls: `t."calls" > 0`,
  errors: `t."errors" > 0`,
  recovered: `t."recovered" > 0`,
  unrecovered: `t."errors" > t."recovered"`,
  dropped: `t."dropped" > 0`,
  duplicates: `t."duplicates" > 0`,
  empty: `t."empty" > 0`,
  cited: `t."cited" > 0`,
  notFound: `t."notFound" > 0`,
};

export const TOOL_SIGNALS = Object.keys(SIGNAL_CONDITIONS) as ToolSignal[];

const ERROR_SHAPED = new Set<ToolSignal>(["errors", "recovered", "unrecovered", "notFound"]);

/** Triggers whose text is system-authored. */
const SYSTEM_TRIGGERS = new Set(["scheduled", "automation"]);

export interface MetricSessionRow {
  id: string;
  sessionId: string;
  conversationId: string | null;
  channelId: string | null;
  agentSlug: string;
  userId: string;
  userName: string | null;
  userEmail: string | null;
  triggerSource: string;
  status: string;
  task: string | null;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  totalMs: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  rating: string | null;
  /** Ran under the owner's personal credentials and the viewer is not the owner: text withheld. */
  restricted: boolean;
  tool?: { c: number; e: number; rec: number; unrec: number; d: number; dup: number; z: number; ci: number; nf: number; ms: number };
  sample?: string | null;
  error?: string | null;
  split?: { llmMs: number | null; toolMs: number | null; totalMs: number | null; topTools: Array<{ tool: string; ms: number; calls: number; errored: boolean }> };
  model?: { calls: number; ttftMaxMs: number | null; ctxMax: number | null; retries: number; errorStops: number };
}

export interface MetricSessionsRequest {
  kind: SessionKind;
  tool?: string | undefined;
  signal?: ToolSignal | undefined;
  errorClass?: string | undefined;
  status?: Array<"failed" | "cancelled"> | undefined;
  minMs?: number | undefined;
  model?: string | undefined;
  provider?: string | undefined;
  limit: number;
  cursor?: string | undefined;
  count?: boolean | undefined;
}

export interface MetricSessionsViewer {
  requesterAliases: string[];
  isAdmin: boolean;
  /** Agent tools: also withhold other users' text unless the run was system-triggered. */
  strictText?: boolean | undefined;
}

export interface MetricSessionsResult {
  rows: MetricSessionRow[];
  page: { limit: number; nextCursor: string | null; hasMore: boolean };
  total: { value: number; capped: boolean } | null;
  coverage: { runsInWindow: number; runsSummarised: number };
}

export const MAX_SESSION_PAGE = 50;
export const DEFAULT_SESSION_PAGE = 25;
/** An uncapped count of a popular tool cost 1.2 s; capped it is <= 62 ms. */
export const SESSION_COUNT_CAP = 1000;
const MAX_TOOL_NAME = 200;
const DRILL_TIMEOUT_MS = 3_000;

/** `w` names the sort key the cursor was issued for, so it cannot be replayed against another ordering. */
export interface SessionCursor {
  w: "completedAt" | "wall";
  k: number;
  id: string;
}

export function encodeCursor(c: SessionCursor): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}

export function decodeCursor(raw: string, expected: SessionCursor["w"]): SessionCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw new MetricsBadRequestError("invalid cursor");
  }
  const c = parsed as Partial<SessionCursor> | null;
  if (!c || typeof c !== "object" || typeof c.id !== "string" || c.id.length === 0 || c.id.length > 64
    || typeof c.k !== "number" || !Number.isFinite(c.k)) {
    throw new MetricsBadRequestError("invalid cursor");
  }
  if (c.w !== expected) throw new MetricsBadRequestError("cursor does not belong to this list");
  return { w: c.w, k: c.k, id: c.id };
}

export interface NormalisedSessionsRequest {
  kind: SessionKind;
  limit: number;
  tool: string | null;
  signal: ToolSignal;
  errorClass: string | null;
  statuses: string[];
  minMs: number | null;
  model: string | null;
  provider: string | null;
  cursor: SessionCursor | null;
  count: boolean;
}

/** Whitelists and clamps every input; anything a caller can fix is a MetricsBadRequestError (HTTP 400). */
export function normaliseSessionsRequest(req: MetricSessionsRequest): NormalisedSessionsRequest {
  if (!SESSION_KINDS.includes(req.kind)) throw new MetricsBadRequestError("kind must be one of tool, failed, slow, model");
  const limit = Math.min(Math.max(Math.trunc(Number.isFinite(req.limit) ? req.limit : DEFAULT_SESSION_PAGE), 1), MAX_SESSION_PAGE);
  const tool = req.tool?.trim() || null;
  if (req.kind === "tool" && !tool) throw new MetricsBadRequestError("tool is required for kind=tool");
  if (tool && tool.length > MAX_TOOL_NAME) throw new MetricsBadRequestError("tool name too long");
  const signal = req.signal ?? "calls";
  if (!TOOL_SIGNALS.includes(signal)) throw new MetricsBadRequestError(`signal must be one of ${TOOL_SIGNALS.join(", ")}`);
  const errorClass = req.errorClass?.trim() ? req.errorClass.trim().slice(0, 160) : null;
  const statuses = req.status && req.status.length > 0 ? [...new Set(req.status)] : ["failed", "cancelled"];
  if (statuses.some((s) => s !== "failed" && s !== "cancelled")) throw new MetricsBadRequestError("status must be failed or cancelled");
  const model = req.model?.trim() || null;
  if (req.kind === "model" && !model) throw new MetricsBadRequestError("model is required for kind=model");
  const minMs = req.minMs !== undefined && Number.isFinite(req.minMs) && req.minMs > 0 ? Math.trunc(req.minMs) : null;
  const cursor = req.cursor ? decodeCursor(req.cursor, req.kind === "slow" ? "wall" : "completedAt") : null;
  return {
    kind: req.kind,
    limit,
    tool,
    signal,
    errorClass,
    statuses,
    minMs,
    model,
    provider: req.provider?.trim() || null,
    cursor,
    count: req.count === true && !cursor,
  };
}

/** Tool kinds page over agent_run_tool_stats (alias t); the rest over agent_runs (alias r). */
const sourceTable = (q: NormalisedSessionsRequest): Prisma.Sql =>
  q.kind === "tool" ? Prisma.sql`"agent_run_tool_stats" t` : Prisma.sql`"agent_runs" r`;
const sourceId = (q: NormalisedSessionsRequest): Prisma.Sql => (q.kind === "tool" ? Prisma.sql`t."runId"` : Prisma.sql`r.id`);
const sourceCompletedAt = (q: NormalisedSessionsRequest): Prisma.Sql =>
  q.kind === "tool" ? Prisma.sql`t."completedAt"` : Prisma.sql`r."completedAt"`;
const WALL = (alias: string): Prisma.Sql => Prisma.sql`(${WALL_MS(alias)})::float8`;

/** Shared by the page and the capped count so they cannot diverge. */
export function sessionFilter(w: AnalyticsWindow, q: NormalisedSessionsRequest): Prisma.Sql {
  const wp = windowPredicate(w);
  switch (q.kind) {
    case "tool": {
      const byClass = q.errorClass
        ? Prisma.sql`AND t."errorClasses" @> ${JSON.stringify([{ class: q.errorClass }])}::jsonb`
        : Prisma.empty;
      return Prisma.sql`${statsWindowPredicate(w, "t")} AND t."tool" = ${q.tool} AND ${Prisma.raw(SIGNAL_CONDITIONS[q.signal])} ${byClass}`;
    }
    case "failed":
      return Prisma.sql`${wp} AND r."status" = ANY(${q.statuses}::text[])`;
    case "slow":
      return Prisma.sql`${wp} AND r."status" = 'completed' ${q.minMs !== null ? Prisma.sql`AND ${WALL("r")} >= ${q.minMs}` : Prisma.empty}`;
    case "model": {
      const path = q.provider ? "$[*] ? (@.m == $m && @.p == $p)" : "$[*] ? (@.m == $m)";
      const vars = q.provider
        ? Prisma.sql`jsonb_build_object('m', ${q.model}::text, 'p', ${q.provider}::text)`
        : Prisma.sql`jsonb_build_object('m', ${q.model}::text)`;
      // The per-call series exists only for recent runs; the run-level column matches the rest.
      return Prisma.sql`${wp} AND (r."model" = ${q.model} OR EXISTS (
        SELECT 1 FROM "agent_run_stats" ms
        WHERE ms."runId" = r.id AND jsonb_path_exists(ms."llmCalls", ${path}::jsonpath, ${vars})))`;
    }
  }
}

/** Keyset predicate: keeps a plain range on the btree's leading column. */
function cursorPredicate(q: NormalisedSessionsRequest): Prisma.Sql {
  if (!q.cursor) return Prisma.empty;
  if (q.cursor.w === "wall") {
    return Prisma.sql`AND (${WALL("r")} < ${q.cursor.k} OR (${WALL("r")} = ${q.cursor.k} AND r.id < ${q.cursor.id}))`;
  }
  const k = new Date(q.cursor.k);
  const at = sourceCompletedAt(q);
  return Prisma.sql`AND ${at} <= ${k} AND (${at} < ${k} OR ${sourceId(q)} < ${q.cursor.id})`;
}

export function sessionPageSql(w: AnalyticsWindow, q: NormalisedSessionsRequest): Prisma.Sql {
  const at = sourceCompletedAt(q);
  const sortExpr = q.kind === "slow" ? WALL("r") : Prisma.sql`(extract(epoch FROM ${at}) * 1000)::float8`;
  const orderBy = q.kind === "slow" ? Prisma.sql`ORDER BY ${WALL("r")} DESC, r.id DESC` : Prisma.sql`ORDER BY ${at} DESC, ${sourceId(q)} DESC`;

  const extras: Prisma.Sql[] = [];
  const joins: Prisma.Sql[] = [];
  if (q.kind === "tool") {
    extras.push(Prisma.sql`jsonb_build_object('c', ts."calls", 'e', ts."errors", 'rec', ts."recovered", 'd', ts."dropped",
      'dup', ts."duplicates", 'z', ts."empty", 'ci', ts."cited", 'nf', ts."notFound", 'ms', ts."totalMs") AS tool_stat`);
    joins.push(Prisma.sql`LEFT JOIN "agent_run_tool_stats" ts ON ts."runId" = x.id AND ts."tool" = ${q.tool}`);
    if (ERROR_SHAPED.has(q.signal) || q.errorClass) {
      // Classes are stored in first-hit order, so the first match is the run's first such error.
      extras.push(Prisma.sql`err.sample AS sample`);
      joins.push(Prisma.sql`LEFT JOIN LATERAL (
        SELECT ec.c->>'sample' AS sample
        FROM jsonb_array_elements(ts."errorClasses") WITH ORDINALITY AS ec(c, n)
        WHERE true
          ${q.signal === "notFound" ? Prisma.sql`AND (ec.c->>'notFound')::boolean` : Prisma.empty}
          ${q.errorClass ? Prisma.sql`AND ec.c->>'class' = ${q.errorClass}` : Prisma.empty}
        ORDER BY ec.n LIMIT 1
      ) err ON true`);
    }
  } else if (q.kind === "failed") {
    extras.push(Prisma.sql`left(x."error", 300) AS error`);
  } else if (q.kind === "slow") {
    extras.push(Prisma.sql`x."llmTotalMs" AS llm_ms, x."toolMs" AS tool_ms, tt.top_tools`);
    joins.push(Prisma.sql`LEFT JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object('tool', y."tool", 'ms', y."totalMs", 'calls', y."calls", 'errored', y."errors" > 0)
                       ORDER BY y."totalMs" DESC, y."tool") AS top_tools
      FROM (SELECT "tool", "totalMs", "calls", "errors" FROM "agent_run_tool_stats"
            WHERE "runId" = x.id ORDER BY "totalMs" DESC, "tool" LIMIT 3) y
    ) tt ON true`);
  } else {
    extras.push(Prisma.sql`m.calls AS m_calls, m.ttft_max, m.ctx_max, m.retries AS m_retries, m.error_stops AS m_error_stops`);
    joins.push(Prisma.sql`LEFT JOIN LATERAL (
      SELECT count(*)::int AS calls,
             max((c->>'ttft')::float8) AS ttft_max,
             max(COALESCE((c->>'in')::float8, 0) + COALESCE((c->>'cr')::float8, 0) + COALESCE((c->>'cw')::float8, 0)) AS ctx_max,
             count(*) FILTER (WHERE c->>'rty' = 'true')::int AS retries,
             count(*) FILTER (WHERE c->>'sr' = 'error')::int AS error_stops
      FROM jsonb_array_elements(COALESCE(xs."llmCalls", '[]'::jsonb)) c
      WHERE c->>'m' = ${q.model} AND c->>'sa' IS NULL
        ${q.provider ? Prisma.sql`AND c->>'p' = ${q.provider}` : Prisma.empty}
    ) m ON true`);
  }

  return Prisma.sql`
    WITH page AS MATERIALIZED (
      SELECT ${sourceId(q)} AS id, ${sortExpr} AS sort_key
      FROM ${sourceTable(q)}
      WHERE ${sessionFilter(w, q)}
        ${cursorPredicate(q)}
      ${orderBy}
      LIMIT ${q.limit + 1}
    )
    SELECT
      x.id, x."sessionId", x."conversationId", x."channelId", x."agentSlug", x."userId",
      x."triggerSource", x."status", left(x."task", 160) AS task, x."startedAt", x."completedAt",
      ${WALL("x")} AS wall_ms, x."totalMs", x."tokensIn", x."tokensOut", x."rating", x."usedUserToken",
      u."name" AS user_name, u."email" AS user_email,
      p.sort_key,
      ${Prisma.join(extras, ", ")}
    FROM page p
    JOIN "agent_runs" x ON x.id = p.id
    LEFT JOIN "users" u ON u.id = x."userId"
    ${q.kind === "model" ? Prisma.sql`LEFT JOIN "agent_run_stats" xs ON xs."runId" = x.id` : Prisma.empty}
    ${joins.length > 0 ? Prisma.join(joins, "\n    ") : Prisma.empty}
    ORDER BY p.sort_key DESC, p.id DESC
  `;
}

function countSql(w: AnalyticsWindow, q: NormalisedSessionsRequest): Prisma.Sql {
  return Prisma.sql`
    SELECT count(*)::int AS n FROM (
      SELECT 1 FROM ${sourceTable(q)} WHERE ${sessionFilter(w, q)} LIMIT ${SESSION_COUNT_CAP + 1}
    ) s
  `;
}

interface RawSessionRow {
  id: string; sessionId: string; conversationId: string | null; channelId: string | null; agentSlug: string; userId: string;
  triggerSource: string; status: string; task: string | null; startedAt: Date; completedAt: Date | null;
  wall_ms: number | null; totalMs: number | null; tokensIn: number | null; tokensOut: number | null; rating: string | null;
  usedUserToken: boolean; user_name: string | null; user_email: string | null; sort_key: number;
  tool_stat?: Record<string, unknown> | null; sample?: string | null; error?: string | null;
  llm_ms?: number | null; tool_ms?: number | null; top_tools?: Array<{ tool: string; ms: number; calls: number; errored: boolean }> | null;
  m_calls?: number | null; ttft_max?: number | null; ctx_max?: number | null; m_retries?: number | null; m_error_stops?: number | null;
}

const int = (v: unknown): number => (typeof v === "number" ? v : typeof v === "string" || typeof v === "bigint" ? Number(v) : 0);
const roundOrNull = (v: unknown): number | null => (v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v)));

/** Raw row → API row. Mirrors buildRunListWhere: a personal-credential run shows to others as a row (so the list reconciles with the tile), never as text. */
export function shapeSessionRow(r: RawSessionRow, kind: SessionKind, viewer: MetricSessionsViewer): MetricSessionRow {
  const own = viewer.requesterAliases.includes(r.userId);
  const restricted = r.usedUserToken === true && !own;
  const textAllowed = !restricted && (!viewer.strictText || own || SYSTEM_TRIGGERS.has(r.triggerSource));
  const row: MetricSessionRow = {
    id: r.id,
    sessionId: r.sessionId,
    conversationId: restricted ? null : r.conversationId,
    channelId: r.channelId,
    agentSlug: r.agentSlug,
    userId: r.userId,
    userName: restricted ? null : r.user_name,
    userEmail: restricted ? null : r.user_email,
    triggerSource: r.triggerSource,
    status: r.status,
    task: textAllowed ? r.task : null,
    startedAt: r.startedAt.toISOString(),
    completedAt: r.completedAt ? r.completedAt.toISOString() : null,
    durationMs: roundOrNull(r.wall_ms),
    totalMs: r.totalMs,
    tokensIn: r.tokensIn,
    tokensOut: r.tokensOut,
    rating: r.rating,
    restricted,
  };
  if (kind === "tool") {
    const s = r.tool_stat ?? {};
    const e = int(s["e"]);
    const rec = int(s["rec"]);
    row.tool = { c: int(s["c"]), e, rec, unrec: Math.max(e - rec, 0), d: int(s["d"]), dup: int(s["dup"]), z: int(s["z"]), ci: int(s["ci"]), nf: int(s["nf"]), ms: int(s["ms"]) };
    if ("sample" in r) row.sample = textAllowed ? (r.sample ?? null) : null;
  } else if (kind === "failed") {
    row.error = textAllowed ? (r.error ?? null) : null;
  } else if (kind === "slow") {
    row.split = {
      llmMs: r.llm_ms ?? null,
      toolMs: r.tool_ms ?? null,
      totalMs: r.totalMs,
      topTools: (r.top_tools ?? []).map((t) => ({ tool: t.tool, ms: int(t.ms), calls: int(t.calls), errored: t.errored === true })),
    };
  } else {
    row.model = {
      calls: int(r.m_calls),
      ttftMaxMs: roundOrNull(r.ttft_max),
      ctxMax: roundOrNull(r.ctx_max),
      retries: int(r.m_retries),
      errorStops: int(r.m_error_stops),
    };
  }
  return row;
}

/** One page of sessions behind a metric: page, capped count (page 1) and coverage in parallel. */
export async function fetchMetricSessions(
  w: AnalyticsWindow,
  req: MetricSessionsRequest,
  viewer: MetricSessionsViewer,
): Promise<MetricSessionsResult> {
  const q = normaliseSessionsRequest(req);
  const opts = { customPlan: true, timeoutMs: DRILL_TIMEOUT_MS };
  const [raw, count, coverage] = await Promise.all([
    runAnalytics<RawSessionRow>(sessionPageSql(w, q), opts),
    q.count ? runAnalytics<{ n: number }>(countSql(w, q), opts) : Promise.resolve(null),
    fetchToolStatsCoverage(w),
  ]);
  const hasMore = raw.length > q.limit;
  const pageRows = raw.slice(0, q.limit);
  const last = pageRows[pageRows.length - 1];
  const nextCursor = hasMore && last
    ? encodeCursor({ w: q.kind === "slow" ? "wall" : "completedAt", k: Number(last.sort_key), id: last.id })
    : null;
  const n = count ? int(count[0]?.n) : null;
  return {
    rows: pageRows.map((r) => shapeSessionRow(r, q.kind, viewer)),
    page: { limit: q.limit, nextCursor, hasMore },
    total: n === null ? null : { value: Math.min(n, SESSION_COUNT_CAP), capped: n > SESSION_COUNT_CAP },
    coverage: { runsInWindow: coverage.runsInWindow, runsSummarised: coverage.runsSummarised },
  };
}
