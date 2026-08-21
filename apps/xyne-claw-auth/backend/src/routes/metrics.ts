/**
 * Workspace-wide latency + throughput metrics for the v3 Metrics page.
 *
 * Single endpoint: GET /api/v1/metrics/global?days=7
 *
 * Returns rollups that let the operator answer "are runs getting faster or
 * not". Aggregated across ALL users, ALL agents — no per-user filter. The
 * frontend is admin-only (gated via existing AdminStatusContext).
 *
 * Heavy lifting is one read query against agent_runs. Avoid `SELECT *` —
 * only the latency + status columns are needed, and the `toolInvocations`
 * blob is excluded (a single one can be 50KB+).
 */

import { Router, type Request, type Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { isClawAdmin, getOrgId } from "../middleware/agent-acl.js";
import { getAdminOrgScope, getOrgNameMap, withOrgLabel } from "../lib/admin-org-scope.js";
import { backfillFailureCurator } from "../services/failure-curator-worker.js";
import { fetchToolErrorClasses, fetchToolFailures, type AnalyticsWindow } from "../lib/tool-metrics.js";
import { fetchDeadTools, fetchToolArgUsage } from "../lib/tool-coverage.js";
import { fetchToolCiteRates, fetchCitationConfig, fetchCitationReflection } from "../lib/tool-citations.js";
import {
  fetchToolStats,
  fetchToolStatsCoverage,
  TOOL_SORT_KEYS,
  type ChartAggregation,
  type ChartMeasure,
  type ChartRequest,
  type PageRequest,
  type ToolSortKey,
} from "../lib/tool-stats-read.js";
import {
  fetchLlmCallSeries,
  fetchLlmLatencyByContext,
  fetchLlmLatencyByCallIndex,
  fetchLlmStatsCoverage,
} from "../lib/llm-turn-stats-read.js";
import { backfillToolStats } from "../lib/tool-stats-backfill.js";

import { createLogger } from "../logger.js";
const log = createLogger("metrics");

/**
 * Per-request metrics scope. Admins see every user in their org; everyone
 * else keeps the legacy personal-run view. CLAW_ADMIN can explicitly request
 * orgScope=all, which bypasses the org filter and is audit-logged by
 * getAdminOrgScope.
 */
async function resolveMetricsScope(req: Request, endpoint: string): Promise<{
  userId: string;
  userFilter: Prisma.Sql;
  orgFilter: Prisma.Sql;
  scopeUserId: string | undefined;
  scopeOrgId: string | undefined;
  allOrgs: boolean;
}> {
  const userId = String(req.headers["x-user-id"] ?? "");
  if (!userId) throw new Error("x-user-id header is required");
  const admin = await isClawAdmin(userId);
  const adminScope = getAdminOrgScope(req, endpoint, admin);
  const fallbackOrgId = adminScope.orgId
    ?? (adminScope.allOrgs ? undefined : (await prisma.user.findUnique({ where: { id: userId }, select: { orgId: true } }))?.orgId);
  if (!adminScope.allOrgs && !fallbackOrgId) {
    throw new Error("orgId is required");
  }
  return {
    userId,
    userFilter: admin ? Prisma.empty : Prisma.sql`AND "userId" = ${userId}`,
    orgFilter: adminScope.allOrgs ? Prisma.empty : Prisma.sql`AND "orgId" = ${fallbackOrgId}`,
    scopeUserId: admin ? undefined : userId,
    scopeOrgId: adminScope.allOrgs ? undefined : fallbackOrgId,
    allOrgs: adminScope.allOrgs,
  };
}

export const metricsRouter = Router();

const ALLOWED_DAYS = new Set([1, 7, 30]);
const DEFAULT_DAYS = 7;

type TriggerGroup = "user" | "automation" | "scheduled" | "api";
const TRIGGER_GROUPS: TriggerGroup[] = ["user", "automation", "scheduled", "api"];

function parseDays(req: Request): number {
  const raw = Number(req.query["days"]);
  return ALLOWED_DAYS.has(raw) ? raw : DEFAULT_DAYS;
}

/** Bounds the scan a hand-written URL can ask for. */
const MAX_WINDOW_DAYS = 366;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface ResolvedWindow {
  windowStart: Date;
  windowEnd: Date;
  /** Same length immediately before the window — the denominator for deltas. */
  prevWindowStart: Date;
  /** Window length in days, echoed to the client. Fractional for sub-day ranges. */
  days: number;
  /** True when the caller gave explicit dates rather than a preset. */
  explicit: boolean;
}

/**
 * Parses `?from=&to=`, falling back to the `?days=` preset.
 *
 * A DATE-ONLY value means the whole UTC day — `from=2026-08-15` starts at
 * 00:00:00Z and `to=2026-08-15` ends at 23:59:59.999Z, so a single date selects
 * that day rather than a zero-length window. Callers that care about a local
 * calendar day should send full ISO instants; those are used verbatim.
 *
 * Shared by the run-level and the deep endpoints so a date range cannot mean
 * one thing on the overview and another on the tool tabs.
 */
function parseWindow(req: Request): ResolvedWindow {
  const rawFrom = typeof req.query["from"] === "string" ? req.query["from"].trim() : "";
  const rawTo = typeof req.query["to"] === "string" ? req.query["to"].trim() : "";

  const dateOnly = (v: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(v);
  const parse = (v: string, edge: "start" | "end"): Date | null => {
    if (!v) return null;
    const iso = dateOnly(v) ? `${v}T${edge === "start" ? "00:00:00.000" : "23:59:59.999"}Z` : v;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  };

  // Order the RAW values before applying edges. Swapping parsed instants would
  // hand day-END to `from` and day-START to `to`, so a reversed range came out
  // narrower than the identical range typed forward.
  let lo = rawFrom;
  let hi = rawTo;
  if (lo && hi) {
    const cmp = (v: string): number => new Date(dateOnly(v) ? `${v}T00:00:00.000Z` : v).getTime();
    if (cmp(lo) > cmp(hi)) [lo, hi] = [hi, lo];
  }

  const from = parse(lo, "start");
  const to = parse(hi, "end");

  if (from || to) {
    const now = Date.now();
    // Never let the window end in the future: a `to` past now would otherwise
    // slide the whole clamped span into a period that cannot contain any runs.
    let endMs = Math.min((to ?? new Date()).getTime(), now);
    // `from` missing but `to` present → the preset length ending at `to`.
    const fallbackDays = parseDays(req);
    let startMs = (from ?? new Date(endMs - fallbackDays * DAY_MS)).getTime();
    // Raw values were ordered above; this only catches a `from` later than a
    // clamped `to` (a future `to` pulled back to now).
    if (startMs > endMs) startMs = endMs;

    const span = Math.min(endMs - startMs, MAX_WINDOW_DAYS * DAY_MS);
    const windowEnd = new Date(endMs);
    const clampedStart = new Date(endMs - span);
    return {
      windowStart: clampedStart,
      windowEnd,
      prevWindowStart: new Date(clampedStart.getTime() - span),
      days: Math.max(1, Math.round(span / DAY_MS)),
      explicit: true,
    };
  }

  const days = parseDays(req);
  const windowEnd = new Date();
  const windowStart = new Date(windowEnd.getTime() - days * DAY_MS);
  return {
    windowStart,
    windowEnd,
    prevWindowStart: new Date(windowStart.getTime() - days * DAY_MS),
    days,
    explicit: false,
  };
}

/**
 * Optional single-session scope.
 *
 * `agent_runs.sessionId` is unique, so this collapses every query to one run —
 * the cheapest filter available and the one that turns these dashboards into a
 * per-session forensic view.
 */
function parseSessionId(req: Request): string | undefined {
  const raw = req.query["sessionId"];
  const value = typeof raw === "string" ? raw.trim() : "";
  return value ? value : undefined;
}

interface DayBucket {
  day: string; // ISO date YYYY-MM-DD
  runs: number;
  completed: number;
  failed: number;
  cancelled: number;
  p50TotalMs: number | null;
  p95TotalMs: number | null;
  avgLlmMs: number | null;
  avgToolMs: number | null;
  errorRate: number; // 0..1
  user?: number;
  automation?: number;
  scheduled?: number;
  api?: number;
}

interface AgentRow {
  agentSlug: string;
  orgId?: string | null;
  orgName?: string | null;
  runs: number;
  p50TotalMs: number | null;
  p95TotalMs: number | null;
  avgLlmMs: number | null;
  avgToolMs: number | null;
  errorRate: number;
}

interface ProviderRow {
  provider: string;
  model: string | null;
  runs: number;
  p50LlmMs: number | null;
  p95LlmMs: number | null;
  p50TtftMs: number | null;
  p95TtftMs: number | null;
  avgTokensPerSec: number | null;
  errorRate: number;
}

interface TriggerRow {
  trigger: TriggerGroup;
  runs: number;
  completed: number;
  failed: number;
  cancelled: number;
  errorRate: number;
  p50TotalMs: number | null;
  p95TotalMs: number | null;
}

interface SlowSessionToolRow {
  tool: string;
  ms: number;       // sum of durationMs across this tool's calls in the session
  calls: number;    // how many times this tool was invoked
  isError: boolean; // any of the calls errored
}

interface SlowSession {
  sessionId: string;
  agentSlug: string;
  totalMs: number | null;
  llmTotalMs: number | null;
  toolMs: number | null;
  completedAt: string;
  task: string | null;
  topTools: SlowSessionToolRow[];
}

/**
 * Top-N slowest sessions in the window, with per-session top-3 tools (by
 * cumulative ms). Pulls `toolInvocations` JSONB and aggregates in Node so
 * we don't have to LATERAL-join in SQL. 20 sessions × ~30 tool rows each
 * keeps the payload bounded.
 */
async function fetchSlowSessions(opts: {
  windowStart: Date;
  windowEnd: Date;
  agentSlug?: string | undefined;
  scopeUserId?: string | undefined;
  scopeOrgId?: string | undefined;
  limit: number;
}): Promise<SlowSession[]> {
  const rows = await prisma.agentRun.findMany({
    where: {
      completedAt: { gte: opts.windowStart, lt: opts.windowEnd },
      totalMs: { not: null },
      ...(opts.agentSlug ? { agentSlug: opts.agentSlug } : {}),
      ...(opts.scopeUserId ? { userId: opts.scopeUserId } : {}),
      ...(opts.scopeOrgId ? { orgId: opts.scopeOrgId } : {}),
    },
    select: {
      sessionId: true, agentSlug: true,
      totalMs: true, llmTotalMs: true, toolMs: true,
      completedAt: true, task: true,
      toolInvocations: true,
    },
    orderBy: { totalMs: "desc" },
    take: opts.limit,
  });

  return rows.map((r) => {
    const invs = Array.isArray(r.toolInvocations)
      ? (r.toolInvocations as Array<Record<string, unknown>>)
      : [];
    // Aggregate by tool name. We're intentionally lenient on shape — the
    // durationMs field can be missing on placeholder rows we never finalised.
    const byTool = new Map<string, { ms: number; calls: number; isError: boolean }>();
    for (const inv of invs) {
      const tool = typeof inv["toolName"] === "string" ? (inv["toolName"] as string) : "(unknown)";
      const ms = typeof inv["durationMs"] === "number" ? (inv["durationMs"] as number) : 0;
      const err = inv["isError"] === true;
      const cur = byTool.get(tool) ?? { ms: 0, calls: 0, isError: false };
      cur.ms += ms;
      cur.calls += 1;
      cur.isError ||= err;
      byTool.set(tool, cur);
    }
    const topTools: SlowSessionToolRow[] = Array.from(byTool.entries())
      .map(([tool, v]) => ({ tool, ms: Math.round(v.ms), calls: v.calls, isError: v.isError }))
      .sort((a, b) => b.ms - a.ms)
      .slice(0, 5);

    return {
      sessionId: r.sessionId,
      agentSlug: r.agentSlug,
      totalMs: r.totalMs,
      llmTotalMs: r.llmTotalMs,
      toolMs: r.toolMs,
      completedAt: r.completedAt!.toISOString(),
      // truncate task to keep the payload light; the UI shows it as a tooltip
      task: r.task ? r.task.slice(0, 240) : null,
      topTools,
    };
  });
}

interface ToolLatencyRow {
  tool: string;
  calls: number;
  errors: number;
  avgMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  totalMs: number;
  /** Calls whose `tool_execution_end` push never landed; excluded from the latency figures above. */
  droppedEnd: number;
  droppedEndRate: number;
}

interface SentimentComment {
  sessionId: string;
  rating: "up" | "down";
  comment: string;
  completedAt: string;
}

interface AgentSentiment {
  totalRuns: number;
  ratingUp: number;
  ratingDown: number;
  ratingTotal: number;        // rated runs (up + down)
  ratingRatio: number | null; // up / total, null when no ratings
  cancelledRate: number;
  failedRate: number;
  retriedRate: number;        // % of runs that had at least one LLM retry
  apologeticRate: number;     // % of completed results matching apologetic regex
  recentComments: SentimentComment[];
}

/**
 * Heuristic sentiment + behavioural rollup for an agent. All signals come
 * from columns we already persist on agent_runs, so this is one SQL hit + a
 * second small fetch for recent rating comments. No LLM cost.
 *
 * "Apologetic" regex catches common "I couldn't / I don't have / sorry"
 * markers in the result text — a proxy for the agent telling the user it
 * failed to do something, even when the run technically completed.
 */
async function fetchSentiment(opts: {
  windowStart: Date;
  windowEnd: Date;
  agentSlug: string;
  userFilter: Prisma.Sql;
  orgFilter: Prisma.Sql;
  scopeUserId?: string | undefined;
  scopeOrgId?: string | undefined;
}): Promise<AgentSentiment> {
  const rows = await prisma.$queryRaw<Array<{
    total_runs: bigint;
    rating_up: bigint;
    rating_down: bigint;
    cancelled: bigint;
    failed: bigint;
    retried: bigint;
    apologetic: bigint;
    completed: bigint;
  }>>`
    SELECT
      COUNT(*)                                                              AS total_runs,
      COUNT(*) FILTER (WHERE "rating" = 'up')                               AS rating_up,
      COUNT(*) FILTER (WHERE "rating" = 'down')                             AS rating_down,
      COUNT(*) FILTER (WHERE status = 'cancelled')                          AS cancelled,
      COUNT(*) FILTER (WHERE status = 'failed')                             AS failed,
      COUNT(*) FILTER (WHERE "llmRetries" IS NOT NULL AND "llmRetries" > 0) AS retried,
      COUNT(*) FILTER (
        WHERE status = 'completed'
          AND result IS NOT NULL
          AND result ~* '\m(I couldn|I can\W?t|I don\W?t have|sorry|unable to|I am not able|I cannot|I do not have|I don\W?t know|no findings|I was unable)'
      )                                                                     AS apologetic,
      COUNT(*) FILTER (WHERE status = 'completed')                          AS completed
    FROM "agent_runs"
    WHERE "agentSlug" = ${opts.agentSlug}
      AND "completedAt" >= ${opts.windowStart}
      AND "completedAt" <  ${opts.windowEnd}
      ${opts.userFilter}
      ${opts.orgFilter}
  `;

  const r = rows[0];
  const total = r ? Number(r.total_runs) : 0;
  const completedCount = r ? Number(r.completed) : 0;
  const up = r ? Number(r.rating_up) : 0;
  const down = r ? Number(r.rating_down) : 0;
  const ratingTotal = up + down;

  // Recent comments — most-recent 12, only rows with a non-empty comment.
  // Separate query keeps the rollup above on its own simple plan.
  const comments = await prisma.agentRun.findMany({
    where: {
      agentSlug: opts.agentSlug,
      completedAt: { gte: opts.windowStart, lt: opts.windowEnd },
      ratingComment: { not: null },
      rating: { in: ["up", "down"] },
      ...(opts.scopeUserId ? { userId: opts.scopeUserId } : {}),
      ...(opts.scopeOrgId ? { orgId: opts.scopeOrgId } : {}),
    },
    select: { sessionId: true, rating: true, ratingComment: true, completedAt: true },
    orderBy: { ratedAt: "desc" },
    take: 12,
  });

  return {
    totalRuns: total,
    ratingUp: up,
    ratingDown: down,
    ratingTotal,
    ratingRatio: ratingTotal > 0 ? up / ratingTotal : null,
    cancelledRate: total > 0 ? Number(r!.cancelled) / total : 0,
    failedRate:    total > 0 ? Number(r!.failed)    / total : 0,
    retriedRate:   total > 0 ? Number(r!.retried)   / total : 0,
    // apologetic rate is a fraction of COMPLETED runs (so a failed run that
    // never produced text doesn't inflate the denominator).
    apologeticRate: completedCount > 0 ? Number(r!.apologetic) / completedCount : 0,
    recentComments: comments
      .filter((c) => c.ratingComment && c.ratingComment.trim().length > 0)
      .map((c) => ({
        sessionId: c.sessionId,
        rating: c.rating as "up" | "down",
        comment: c.ratingComment!.slice(0, 600),
        completedAt: c.completedAt!.toISOString(),
      })),
  };
}

/**
 * Per-tool aggregation for an agent. Unnests every run's toolInvocations
 * JSONB and groups by toolName, surfacing where the agent burns time.
 *
 * Postgres can do this in a single LATERAL + jsonb_array_elements query;
 * the percentile is cheap because the per-tool population is small.
 */
/**
 * Per-tool latency for the agent page.
 *
 * Reads the precomputed `toolStats` column rather than unnesting the
 * invocations blob — the same numbers at ~57ms instead of ~850ms. Runs that
 * predate the column are invisible until backfilled, which is why the agent
 * response carries `toolStatsCoverage`.
 *
 * `p50Ms`/`p95Ms` are bucket-resolution here (summed histograms); `avgMs` and
 * the totals stay exact. `droppedEnd` surfaces the calls whose
 * tool_execution_end push never landed — previously counted as instant
 * successes, which deflated every figure in this table.
 *
 * Stays on the `completedAt` window so it remains consistent with the other
 * cards on the same page.
 */
async function fetchToolLatency(opts: {
  windowStart: Date;
  windowEnd: Date;
  agentSlug: string;
  userFilter: Prisma.Sql;
  orgFilter: Prisma.Sql;
  limit: number;
}): Promise<ToolLatencyRow[]> {
  const stats = await fetchToolStats(
    {
      windowStart: opts.windowStart,
      windowEnd: opts.windowEnd,
      windowColumn: "completedAt",
      agentSlugs: opts.agentSlug ? [opts.agentSlug] : undefined,
      userFilter: opts.userFilter,
      orgFilter: opts.orgFilter,
    },
    // Ordered by cumulative time — this table exists to surface the tool
    // dragging one agent down, which is a totalMs question, not a volume one.
    { limit: opts.limit, offset: 0, sort: "totalMs", dir: "desc" },
  );

  return stats.rows
    .map((s) => ({
      tool: s.tool,
      calls: s.calls,
      errors: s.errors,
      avgMs: s.avgMs,
      p50Ms: s.p50Ms,
      p95Ms: s.p95Ms,
      totalMs: s.totalMs,
      droppedEnd: s.droppedEnd,
      droppedEndRate: s.droppedEndRate,
    }))
    .sort((a, b) => b.totalMs - a.totalMs);
}

interface MetricsResponse {
  days: number;
  windowStart: string;
  windowEnd: string;
  totals: {
    runs: number;
    completed: number;
    failed: number;
    cancelled: number;
    p50TotalMs: number | null;
    p95TotalMs: number | null;
    avgLlmMs: number | null;
    avgToolMs: number | null;
    errorRate: number;
    /** Window token totals — fresh input, cached (read/write), and output. */
    tokens?: { in: number; out: number; cacheRead: number; cacheWrite: number };
    /** Distinct users in the window. */
    uniqueUsers?: number;
    /** Memory adoption — runs that recalled >=1 memory (per-agent endpoint only). */
    memoryRecall?: { runsWithRecall: number; rate: number };
  };
  delta: {
    runs: number;       // current - previous (raw)
    p50TotalMs: number | null;
    p95TotalMs: number | null;
    errorRate: number;
  };
  perDay: DayBucket[];
  byTrigger: TriggerRow[];
  topAgents: AgentRow[];
  byProvider: ProviderRow[];
  slowSessions: SlowSession[];
}

/**
 * Same shape as `/global` but scoped to a single agentSlug. Used by the
 * agent detail page's Metrics tab so we don't have to filter a global
 * payload client-side. One extra WHERE clause per query; same plan.
 */
metricsRouter.get("/agent/:slug", async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const { userFilter, orgFilter, scopeUserId, scopeOrgId } = await resolveMetricsScope(req, "/metrics/agent");
    const slug = req.params.slug;
    const { windowStart, windowEnd, prevWindowStart, days } = parseWindow(req);

    const perDayRaw = await prisma.$queryRaw<Array<{
      day: Date;
      runs: bigint;
      completed: bigint;
      failed: bigint;
      cancelled: bigint;
      p50_total_ms: number | null;
      p95_total_ms: number | null;
      avg_llm_ms: number | null;
      avg_tool_ms: number | null;
    }>>`
      SELECT
        date_trunc('day', "completedAt")::date AS day,
        COUNT(*)                                       AS runs,
        COUNT(*) FILTER (WHERE status = 'completed')   AS completed,
        COUNT(*) FILTER (WHERE status = 'failed')      AS failed,
        COUNT(*) FILTER (WHERE status = 'cancelled')   AS cancelled,
        PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY "totalMs")    AS p50_total_ms,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY "totalMs")    AS p95_total_ms,
        AVG("llmTotalMs")                              AS avg_llm_ms,
        AVG("toolMs")                                  AS avg_tool_ms
      FROM "agent_runs"
      WHERE "agentSlug" = ${slug}
        AND "completedAt" >= ${windowStart}
        AND "completedAt" <  ${windowEnd}
        -- Janitor closures of month-old zombie rows (orphan-finalizer) carry
        -- completedAt = sweep time; counting them as window activity paints
        -- false failure spikes on the day of the sweep (2026-07-08 backlog).
        AND (error IS NULL OR error <> 'interrupted (orphaned run)')
        ${userFilter}
        ${orgFilter}
      GROUP BY 1
      ORDER BY 1 ASC
    `;

    const totalsRaw = await prisma.$queryRaw<Array<{
      runs: bigint;
      completed: bigint;
      failed: bigint;
      cancelled: bigint;
      p50_total_ms: number | null;
      p95_total_ms: number | null;
      avg_llm_ms: number | null;
      avg_tool_ms: number | null;
      avg_turns: number | null;
      avg_tps: number | null;
      tokens_in: bigint;
      tokens_out: bigint;
      tokens_cache_read: bigint;
      tokens_cache_write: bigint;
      unique_users: bigint;
    }>>`
      SELECT
        COUNT(*)                                       AS runs,
        COUNT(DISTINCT "userId")                       AS unique_users,
        COUNT(*) FILTER (WHERE status = 'completed')   AS completed,
        COUNT(*) FILTER (WHERE status = 'failed')      AS failed,
        COUNT(*) FILTER (WHERE status = 'cancelled')   AS cancelled,
        PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY "totalMs")    AS p50_total_ms,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY "totalMs")    AS p95_total_ms,
        AVG("llmTotalMs")                              AS avg_llm_ms,
        AVG("toolMs")                                  AS avg_tool_ms,
        AVG("llmTurns")                                AS avg_turns,
        AVG("tokensPerSec")                            AS avg_tps,
        COALESCE(SUM("tokensIn"), 0)                   AS tokens_in,
        COALESCE(SUM("tokensOut"), 0)                  AS tokens_out,
        COALESCE(SUM("tokensCacheRead"), 0)            AS tokens_cache_read,
        COALESCE(SUM("tokensCacheWrite"), 0)           AS tokens_cache_write
      FROM "agent_runs"
      WHERE "agentSlug" = ${slug}
        AND "completedAt" >= ${windowStart}
        AND "completedAt" <  ${windowEnd}
        -- Janitor closures of month-old zombie rows (orphan-finalizer) carry
        -- completedAt = sweep time; counting them as window activity paints
        -- false failure spikes on the day of the sweep (2026-07-08 backlog).
        AND (error IS NULL OR error <> 'interrupted (orphaned run)')
        ${userFilter}
        ${orgFilter}
    `;

    const prevRaw = await prisma.$queryRaw<Array<{
      runs: bigint;
      p50_total_ms: number | null;
      p95_total_ms: number | null;
      errors: bigint;
    }>>`
      SELECT
        COUNT(*)                                                   AS runs,
        PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY "totalMs")    AS p50_total_ms,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY "totalMs")    AS p95_total_ms,
        COUNT(*) FILTER (WHERE status IN ('failed','cancelled'))   AS errors
      FROM "agent_runs"
      WHERE "agentSlug" = ${slug}
        AND "completedAt" >= ${prevWindowStart}
        AND "completedAt" <  ${windowStart}
        ${userFilter}
        ${orgFilter}
    `;

    const round = (n: number | null): number | null => (n == null ? null : Math.round(n));
    const t = totalsRaw[0];
    const totalsRuns = t ? Number(t.runs) : 0;
    const totalsErrors = t ? Number(t.failed) + Number(t.cancelled) : 0;
    const p = prevRaw[0];
    const prevRuns = p ? Number(p.runs) : 0;
    const prevErrors = p ? Number(p.errors) : 0;

    res.json({
      agentSlug: slug,
      days,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      totals: {
        runs: totalsRuns,
        completed: t ? Number(t.completed) : 0,
        failed: t ? Number(t.failed) : 0,
        cancelled: t ? Number(t.cancelled) : 0,
        p50TotalMs: round(t?.p50_total_ms ?? null),
        p95TotalMs: round(t?.p95_total_ms ?? null),
        avgLlmMs: round(t?.avg_llm_ms ?? null),
        avgToolMs: round(t?.avg_tool_ms ?? null),
        avgTurns: t?.avg_turns != null ? Number(t.avg_turns.toFixed(2)) : null,
        avgTokensPerSec: round(t?.avg_tps ?? null),
        errorRate: totalsRuns > 0 ? totalsErrors / totalsRuns : 0,
        // Token accounting. "fresh" input is what providers bill as new input;
        // cacheRead is prior context replayed from provider cache (cheap but
        // real consumption); cacheWrite is context written to cache. Total
        // input processed = fresh + cacheRead + cacheWrite — reporting only
        // `tokensIn` understates real volume ~10x on cache-heavy agents.
        tokens: {
          in: t ? Number(t.tokens_in) : 0,
          out: t ? Number(t.tokens_out) : 0,
          cacheRead: t ? Number(t.tokens_cache_read) : 0,
          cacheWrite: t ? Number(t.tokens_cache_write) : 0,
        },
        uniqueUsers: t ? Number(t.unique_users) : 0,
        // Memory adoption: fraction of runs that recalled >=1 memory. THE
        // number to manage after ingesting sessions — a fat bank nobody
        // queries is dead weight (2026-07-20: ~1% of runs used memory).
        memoryRecall: await (async () => {
          const sessions = await prisma.$queryRaw<Array<{ n: bigint }>>`
            SELECT COUNT(DISTINCT "sessionId") AS n
            FROM "memory_recall_hits"
            WHERE "agentSlug" = ${slug}
              AND "recalledAt" >= ${windowStart}
              AND "recalledAt" <  ${windowEnd}
          `;
          const withRecall = sessions[0] ? Number(sessions[0].n) : 0;
          return { runsWithRecall: withRecall, rate: totalsRuns > 0 ? withRecall / totalsRuns : 0 };
        })(),
      },
      delta: {
        runs: totalsRuns - prevRuns,
        p50TotalMs: t?.p50_total_ms != null && p?.p50_total_ms != null
          ? Math.round(t.p50_total_ms - p.p50_total_ms) : null,
        p95TotalMs: t?.p95_total_ms != null && p?.p95_total_ms != null
          ? Math.round(t.p95_total_ms - p.p95_total_ms) : null,
        errorRate: (totalsRuns > 0 ? totalsErrors / totalsRuns : 0) -
                   (prevRuns > 0 ? prevErrors / prevRuns : 0),
      },
      perDay: perDayRaw.map((r) => {
        const runs = Number(r.runs);
        const errors = Number(r.failed) + Number(r.cancelled);
        return {
          day: r.day.toISOString().slice(0, 10),
          runs,
          completed: Number(r.completed),
          failed: Number(r.failed),
          cancelled: Number(r.cancelled),
          p50TotalMs: round(r.p50_total_ms ?? null),
          p95TotalMs: round(r.p95_total_ms ?? null),
          avgLlmMs: round(r.avg_llm_ms ?? null),
          avgToolMs: round(r.avg_tool_ms ?? null),
          errorRate: runs > 0 ? errors / runs : 0,
        };
      }),
      slowSessions: await fetchSlowSessions({ windowStart, windowEnd, agentSlug: slug, scopeUserId, scopeOrgId, limit: 20 }),
      toolLatency:  await fetchToolLatency({ windowStart, windowEnd, agentSlug: slug, userFilter, orgFilter, limit: 30 }),
      sentiment:    await fetchSentiment({ windowStart, windowEnd, agentSlug: slug, userFilter, orgFilter, scopeUserId, scopeOrgId }),
    });
  } catch (err) {
    log.error("[metrics/agent] error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

metricsRouter.get("/global", async (req: Request, res: Response) => {
  try {
    const { userFilter, orgFilter, scopeUserId, scopeOrgId, allOrgs } = await resolveMetricsScope(req, "/metrics/global");
    const { windowStart, windowEnd, prevWindowStart, days } = parseWindow(req);

    // Per-day rollup. PostgreSQL handles the percentile + grouping in one pass.
    // Using $queryRawUnsafe is unnecessary — parameterise the interval via a
    // computed start timestamp so the query plan stays cacheable.
    const perDayRaw = await prisma.$queryRaw<Array<{
      day: Date;
      runs: bigint;
      completed: bigint;
      failed: bigint;
      cancelled: bigint;
      p50_total_ms: number | null;
      p95_total_ms: number | null;
      avg_llm_ms: number | null;
      avg_tool_ms: number | null;
    }>>`
      SELECT
        date_trunc('day', "completedAt")::date AS day,
        COUNT(*)                                       AS runs,
        COUNT(*) FILTER (WHERE status = 'completed')   AS completed,
        COUNT(*) FILTER (WHERE status = 'failed')      AS failed,
        COUNT(*) FILTER (WHERE status = 'cancelled')   AS cancelled,
        PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY "totalMs")    AS p50_total_ms,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY "totalMs")    AS p95_total_ms,
        AVG("llmTotalMs")                              AS avg_llm_ms,
        AVG("toolMs")                                  AS avg_tool_ms
      FROM "agent_runs"
      WHERE "completedAt" >= ${windowStart}
        AND "completedAt" <  ${windowEnd}
        -- Janitor closures of month-old zombie rows (orphan-finalizer) carry
        -- completedAt = sweep time; counting them as window activity paints
        -- false failure spikes on the day of the sweep (2026-07-08 backlog).
        AND (error IS NULL OR error <> 'interrupted (orphaned run)')
        ${userFilter}
        ${orgFilter}
      GROUP BY 1
      ORDER BY 1 ASC
    `;

    // Per-agent leaderboard, top 20 by runs.
    const topAgentsRaw = await prisma.$queryRaw<Array<{
      agentSlug: string;
      orgId: string;
      runs: bigint;
      p50_total_ms: number | null;
      p95_total_ms: number | null;
      avg_llm_ms: number | null;
      avg_tool_ms: number | null;
      errors: bigint;
    }>>`
      SELECT
        "agentSlug",
        "orgId",
        COUNT(*)                                                   AS runs,
        PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY "totalMs")    AS p50_total_ms,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY "totalMs")    AS p95_total_ms,
        AVG("llmTotalMs")                                          AS avg_llm_ms,
        AVG("toolMs")                                              AS avg_tool_ms,
        COUNT(*) FILTER (WHERE status IN ('failed','cancelled'))   AS errors
      FROM "agent_runs"
      WHERE "completedAt" >= ${windowStart}
        AND "completedAt" <  ${windowEnd}
        -- Janitor closures of month-old zombie rows (orphan-finalizer) carry
        -- completedAt = sweep time; counting them as window activity paints
        -- false failure spikes on the day of the sweep (2026-07-08 backlog).
        AND (error IS NULL OR error <> 'interrupted (orphaned run)')
        ${userFilter}
        ${orgFilter}
      GROUP BY "agentSlug", "orgId"
      ORDER BY runs DESC
      LIMIT 20
    `;

    const byProviderRaw = await prisma.$queryRaw<Array<{
      provider: string;
      model: string | null;
      runs: bigint;
      p50_llm_ms: number | null;
      p95_llm_ms: number | null;
      p50_ttft_ms: number | null;
      p95_ttft_ms: number | null;
      avg_tps: number | null;
      errors: bigint;
    }>>`
      SELECT
        provider,
        model,
        COUNT(*)                                                        AS runs,
        PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY "llmTotalMs")      AS p50_llm_ms,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY "llmTotalMs")      AS p95_llm_ms,
        PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY "ttftMs")          AS p50_ttft_ms,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY "ttftMs")          AS p95_ttft_ms,
        AVG("tokensPerSec")                                             AS avg_tps,
        COUNT(*) FILTER (WHERE status IN ('failed','cancelled'))        AS errors
      FROM "agent_runs"
      WHERE "completedAt" >= ${windowStart}
        AND "completedAt" <  ${windowEnd}
        -- Janitor closures of month-old zombie rows (orphan-finalizer) carry
        -- completedAt = sweep time; counting them as window activity paints
        -- false failure spikes on the day of the sweep (2026-07-08 backlog).
        AND (error IS NULL OR error <> 'interrupted (orphaned run)')
        AND provider IS NOT NULL
        ${userFilter}
        ${orgFilter}
      GROUP BY provider, model
      ORDER BY runs DESC, provider ASC, model ASC NULLS LAST
    `;

    // Pre-existing automation rows keep their old labels: webhook automation
    // history was written as api, and other internal automation dispatches
    // fell through as spaces before triggerSource=automation existed.
    const byTriggerRaw = await prisma.$queryRaw<Array<{
      trigger_group: TriggerGroup;
      runs: bigint;
      completed: bigint;
      failed: bigint;
      cancelled: bigint;
      p50_total_ms: number | null;
      p95_total_ms: number | null;
    }>>`
      WITH classified AS (
        SELECT
          CASE
            WHEN "triggerSource" IN ('spaces', 'chat') THEN 'user'
            WHEN "triggerSource" = 'automation' THEN 'automation'
            WHEN "triggerSource" = 'scheduled' THEN 'scheduled'
            WHEN "triggerSource" = 'api' THEN 'api'
            ELSE 'user'
          END AS trigger_group,
          status,
          "totalMs"
        FROM "agent_runs"
        WHERE "completedAt" >= ${windowStart}
          AND "completedAt" <  ${windowEnd}
          -- Janitor closures of month-old zombie rows (orphan-finalizer)
          -- carry completedAt = sweep time; counting them as window activity
          -- paints false failure spikes on sweep days (2026-07-08 backlog).
          AND (error IS NULL OR error <> 'interrupted (orphaned run)')
          ${userFilter}
          ${orgFilter}
      )
      SELECT
        trigger_group,
        COUNT(*)                                                   AS runs,
        COUNT(*) FILTER (WHERE status = 'completed')               AS completed,
        COUNT(*) FILTER (WHERE status = 'failed')                  AS failed,
        COUNT(*) FILTER (WHERE status = 'cancelled')               AS cancelled,
        PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY "totalMs")    AS p50_total_ms,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY "totalMs")    AS p95_total_ms
      FROM classified
      GROUP BY trigger_group
      ORDER BY trigger_group ASC
    `;

    const perDayTriggerRaw = await prisma.$queryRaw<Array<{
      day: Date;
      trigger_group: TriggerGroup;
      runs: bigint;
    }>>`
      WITH classified AS (
        SELECT
          date_trunc('day', "completedAt")::date AS day,
          CASE
            WHEN "triggerSource" IN ('spaces', 'chat') THEN 'user'
            WHEN "triggerSource" = 'automation' THEN 'automation'
            WHEN "triggerSource" = 'scheduled' THEN 'scheduled'
            WHEN "triggerSource" = 'api' THEN 'api'
            ELSE 'user'
          END AS trigger_group
        FROM "agent_runs"
        WHERE "completedAt" >= ${windowStart}
          AND "completedAt" <  ${windowEnd}
          -- Janitor closures of month-old zombie rows (orphan-finalizer)
          -- carry completedAt = sweep time; counting them as window activity
          -- paints false failure spikes on sweep days (2026-07-08 backlog).
          AND (error IS NULL OR error <> 'interrupted (orphaned run)')
          ${userFilter}
          ${orgFilter}
      )
      SELECT
        day,
        trigger_group,
        COUNT(*) AS runs
      FROM classified
      GROUP BY day, trigger_group
      ORDER BY day ASC, trigger_group ASC
    `;

    // Current period totals.
    const totalsRaw = await prisma.$queryRaw<Array<{
      runs: bigint;
      completed: bigint;
      failed: bigint;
      cancelled: bigint;
      p50_total_ms: number | null;
      p95_total_ms: number | null;
      avg_llm_ms: number | null;
      avg_tool_ms: number | null;
      tokens_in: bigint;
      tokens_out: bigint;
      tokens_cache_read: bigint;
      tokens_cache_write: bigint;
      unique_users: bigint;
    }>>`
      SELECT
        COUNT(*)                                       AS runs,
        COUNT(DISTINCT "userId")                       AS unique_users,
        COUNT(*) FILTER (WHERE status = 'completed')   AS completed,
        COUNT(*) FILTER (WHERE status = 'failed')      AS failed,
        COUNT(*) FILTER (WHERE status = 'cancelled')   AS cancelled,
        PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY "totalMs")    AS p50_total_ms,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY "totalMs")    AS p95_total_ms,
        AVG("llmTotalMs")                              AS avg_llm_ms,
        AVG("toolMs")                                  AS avg_tool_ms,
        COALESCE(SUM("tokensIn"), 0)                   AS tokens_in,
        COALESCE(SUM("tokensOut"), 0)                  AS tokens_out,
        COALESCE(SUM("tokensCacheRead"), 0)            AS tokens_cache_read,
        COALESCE(SUM("tokensCacheWrite"), 0)           AS tokens_cache_write
      FROM "agent_runs"
      WHERE "completedAt" >= ${windowStart}
        AND "completedAt" <  ${windowEnd}
        -- Janitor closures of month-old zombie rows (orphan-finalizer) carry
        -- completedAt = sweep time; counting them as window activity paints
        -- false failure spikes on the day of the sweep (2026-07-08 backlog).
        AND (error IS NULL OR error <> 'interrupted (orphaned run)')
        ${userFilter}
        ${orgFilter}
    `;

    // Previous-period totals for delta computation.
    const prevRaw = await prisma.$queryRaw<Array<{
      runs: bigint;
      p50_total_ms: number | null;
      p95_total_ms: number | null;
      errors: bigint;
    }>>`
      SELECT
        COUNT(*)                                                   AS runs,
        PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY "totalMs")    AS p50_total_ms,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY "totalMs")    AS p95_total_ms,
        COUNT(*) FILTER (WHERE status IN ('failed','cancelled'))   AS errors
      FROM "agent_runs"
      WHERE "completedAt" >= ${prevWindowStart}
        AND "completedAt" <  ${windowStart}
        ${userFilter}
        ${orgFilter}
    `;

    const round = (n: number | null): number | null => (n == null ? null : Math.round(n));

    const t = totalsRaw[0];
    const totalsRuns = t ? Number(t.runs) : 0;
    const totalsErrors = t ? Number(t.failed) + Number(t.cancelled) : 0;
    const p = prevRaw[0];
    const prevRuns = p ? Number(p.runs) : 0;
    const prevErrors = p ? Number(p.errors) : 0;
    const orgNames = allOrgs ? await getOrgNameMap(topAgentsRaw.map((r) => r.orgId)) : new Map();
    const byTriggerLookup = new Map<TriggerGroup, TriggerRow>();
    for (const r of byTriggerRaw) {
      const runs = Number(r.runs);
      const errors = Number(r.failed) + Number(r.cancelled);
      byTriggerLookup.set(r.trigger_group, {
        trigger: r.trigger_group,
        runs,
        completed: Number(r.completed),
        failed: Number(r.failed),
        cancelled: Number(r.cancelled),
        errorRate: runs > 0 ? errors / runs : 0,
        p50TotalMs: round(r.p50_total_ms ?? null),
        p95TotalMs: round(r.p95_total_ms ?? null),
      });
    }
    const triggerCountsByDay = new Map<string, Record<TriggerGroup, number>>();
    for (const r of perDayTriggerRaw) {
      const day = r.day.toISOString().slice(0, 10);
      const counts = triggerCountsByDay.get(day) ?? { user: 0, automation: 0, scheduled: 0, api: 0 };
      counts[r.trigger_group] = Number(r.runs);
      triggerCountsByDay.set(day, counts);
    }

    const response: MetricsResponse = {
      days,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      totals: {
        runs: totalsRuns,
        completed: t ? Number(t.completed) : 0,
        failed: t ? Number(t.failed) : 0,
        cancelled: t ? Number(t.cancelled) : 0,
        p50TotalMs: round(t?.p50_total_ms ?? null),
        p95TotalMs: round(t?.p95_total_ms ?? null),
        avgLlmMs: round(t?.avg_llm_ms ?? null),
        avgToolMs: round(t?.avg_tool_ms ?? null),
        errorRate: totalsRuns > 0 ? totalsErrors / totalsRuns : 0,
        // Same accounting as the per-agent endpoint: fresh vs cached input
        // reported separately so the UI can show true volume (fresh+cached).
        tokens: {
          in: t ? Number(t.tokens_in) : 0,
          out: t ? Number(t.tokens_out) : 0,
          cacheRead: t ? Number(t.tokens_cache_read) : 0,
          cacheWrite: t ? Number(t.tokens_cache_write) : 0,
        },
        uniqueUsers: t ? Number(t.unique_users) : 0,
      },
      delta: {
        runs: totalsRuns - prevRuns,
        p50TotalMs: t?.p50_total_ms != null && p?.p50_total_ms != null
          ? Math.round(t.p50_total_ms - p.p50_total_ms) : null,
        p95TotalMs: t?.p95_total_ms != null && p?.p95_total_ms != null
          ? Math.round(t.p95_total_ms - p.p95_total_ms) : null,
        errorRate: (totalsRuns > 0 ? totalsErrors / totalsRuns : 0) -
                   (prevRuns > 0 ? prevErrors / prevRuns : 0),
      },
      perDay: perDayRaw.map((r) => {
        const day = r.day.toISOString().slice(0, 10);
        const runs = Number(r.runs);
        const errors = Number(r.failed) + Number(r.cancelled);
        const triggerCounts = triggerCountsByDay.get(day) ?? { user: 0, automation: 0, scheduled: 0, api: 0 };
        return {
          day,
          runs,
          completed: Number(r.completed),
          failed: Number(r.failed),
          cancelled: Number(r.cancelled),
          p50TotalMs: round(r.p50_total_ms ?? null),
          p95TotalMs: round(r.p95_total_ms ?? null),
          avgLlmMs: round(r.avg_llm_ms ?? null),
          avgToolMs: round(r.avg_tool_ms ?? null),
          errorRate: runs > 0 ? errors / runs : 0,
          user: triggerCounts.user,
          automation: triggerCounts.automation,
          scheduled: triggerCounts.scheduled,
          api: triggerCounts.api,
        };
      }),
      byTrigger: TRIGGER_GROUPS.map((trigger) => byTriggerLookup.get(trigger) ?? ({
        trigger,
        runs: 0,
        completed: 0,
        failed: 0,
        cancelled: 0,
        errorRate: 0,
        p50TotalMs: null,
        p95TotalMs: null,
      })),
      topAgents: topAgentsRaw.map((r) => {
        const runs = Number(r.runs);
        return withOrgLabel({
          agentSlug: r.agentSlug,
          orgId: r.orgId,
          runs,
          p50TotalMs: round(r.p50_total_ms ?? null),
          p95TotalMs: round(r.p95_total_ms ?? null),
          avgLlmMs: round(r.avg_llm_ms ?? null),
          avgToolMs: round(r.avg_tool_ms ?? null),
          errorRate: runs > 0 ? Number(r.errors) / runs : 0,
        }, orgNames);
      }),
      byProvider: byProviderRaw.map((r) => {
        const runs = Number(r.runs);
        return {
          provider: r.provider,
          model: r.model,
          runs,
          p50LlmMs: round(r.p50_llm_ms ?? null),
          p95LlmMs: round(r.p95_llm_ms ?? null),
          p50TtftMs: round(r.p50_ttft_ms ?? null),
          p95TtftMs: round(r.p95_ttft_ms ?? null),
          avgTokensPerSec: round(r.avg_tps ?? null),
          errorRate: runs > 0 ? Number(r.errors) / runs : 0,
        };
      }),
      slowSessions: await fetchSlowSessions({ windowStart, windowEnd, scopeUserId, scopeOrgId, limit: 20 }),
    };

    res.json(response);
  } catch (err) {
    log.error("[metrics/global] error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

// ── Improvement candidates (FailureCurator) ────────────────────────────
//
// Three endpoints powering the /v3/metrics improvement-suggestions card:
//   GET    /agent/:slug/improvements         — list pending for the agent
//   POST   /improvements/:id/apply           — mark applied
//   POST   /improvements/:id/dismiss         — mark dismissed (7d cool-down)
//
// All three accept admins, the agent's OWNER, and contributors (users with
// an AgentShare of role EDITOR or CONTRIBUTOR). Anyone else gets 403. The
// existing `requireAgentOwnerContributorOrAdmin` middleware enforces the
// same rule used for agent settings / agent-pinned MCP credentials, so this
// stays consistent with the rest of the app's permission model.
//
// For the :id-based endpoints (apply/dismiss) we look up the candidate
// first to find its agentSlug, then run the same gate.

async function authorizeAgentEdit(req: Request, res: Response, agentSlug: string): Promise<{ userId: string; orgId: string } | null> {
  const userId = String(req.headers["x-user-id"] ?? "");
  if (!userId) { res.status(401).json({ error: "x-user-id header is required" }); return null; }
  const editOrgId = getOrgId(req);
  if (!editOrgId) {
    log.error(`[metrics/authorize-agent-edit] orgId is required; refusing global agent lookup agentSlug=${agentSlug} userId=${userId}`);
    res.status(400).json({ error: "orgId is required" });
    return null;
  }
  const agent = await prisma.agent.findFirst({
    where: { slug: agentSlug, orgId: editOrgId },
    select: { id: true, ownerUserId: true },
  });
  if (!agent) {
    log.warn(`[metrics/authorize-agent-edit] agent org-scoped miss slug=${agentSlug} orgId=${editOrgId ?? "none"} userId=${userId}`);
    res.status(404).json({ error: "Agent not found" });
    return null;
  }
  const admin = await isClawAdmin(userId);
  if (admin) return { userId, orgId: editOrgId };
  if (agent.ownerUserId === userId) return { userId, orgId: editOrgId };
  const share = await prisma.agentShare.findUnique({
    where: { agentId_userId: { agentId: agent.id, userId } },
    select: { role: true },
  });
  if (share && (share.role === "EDITOR" || share.role === "CONTRIBUTOR")) return { userId, orgId: editOrgId };
  res.status(403).json({ error: "Only the agent owner, contributors, or an admin can perform this action" });
  return null;
}

metricsRouter.get("/agent/:slug/improvements", async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const authorized = await authorizeAgentEdit(req, res, req.params.slug);
    if (!authorized) return;
    const slug = req.params.slug;
    const candidates = await prisma.agentImprovementCandidate.findMany({
      where: { orgId: authorized.orgId, agentSlug: slug, status: "pending" },
      orderBy: [{ confidence: "desc" }, { updatedAt: "desc" }],
      take: 100,
    });
    res.json({
      agentSlug: slug,
      candidates: candidates.map((c) => ({
        id: c.id,
        bucket: c.bucket,
        rootCause: c.rootCause,
        finding: c.finding,
        evidence: Array.isArray(c.evidence) ? c.evidence : [],
        proposedFix: c.proposedFix,
        confidence: c.confidence,
        metadata: c.metadata ?? null,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      })),
    });
  } catch (err) {
    log.error("[metrics/improvements] list error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

metricsRouter.post("/improvements/:id/apply", async (req: Request<{ id: string }>, res: Response) => {
  try {
    // Resolve the candidate first so we know which agent to gate on.
    const candidate = await prisma.agentImprovementCandidate.findUnique({
      where: { id: req.params.id },
      select: { agentSlug: true, orgId: true },
    });
    if (!candidate) { res.status(404).json({ error: "Candidate not found" }); return; }
    const authorized = await authorizeAgentEdit(req, res, candidate.agentSlug);
    if (!authorized) return;
    if (candidate.orgId !== authorized.orgId) {
      log.warn(`[metrics/improvements] candidate org mismatch; refusing apply candidateId=${req.params.id} candidateOrgId=${candidate.orgId} orgId=${authorized.orgId} agentSlug=${candidate.agentSlug}`);
      res.status(404).json({ error: "Candidate not found" });
      return;
    }
    const updated = await prisma.agentImprovementCandidate.update({
      where: { id: req.params.id },
      data: {
        status: "applied",
        metadata: { appliedBy: authorized.userId, appliedAt: new Date().toISOString() } as unknown as Prisma.InputJsonValue,
      },
    });
    res.json({ ok: true, id: updated.id, status: updated.status });
  } catch (err) {
    log.error("[metrics/improvements] apply error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

metricsRouter.post("/improvements/:id/dismiss", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const candidate = await prisma.agentImprovementCandidate.findUnique({
      where: { id: req.params.id },
      select: { agentSlug: true, orgId: true },
    });
    if (!candidate) { res.status(404).json({ error: "Candidate not found" }); return; }
    const authorized = await authorizeAgentEdit(req, res, candidate.agentSlug);
    if (!authorized) return;
    if (candidate.orgId !== authorized.orgId) {
      log.warn(`[metrics/improvements] candidate org mismatch; refusing dismiss candidateId=${req.params.id} candidateOrgId=${candidate.orgId} orgId=${authorized.orgId} agentSlug=${candidate.agentSlug}`);
      res.status(404).json({ error: "Candidate not found" });
      return;
    }
    const reason = String((req.body ?? {})["reason"] ?? "");
    const updated = await prisma.agentImprovementCandidate.update({
      where: { id: req.params.id },
      data: {
        status: "dismissed",
        metadata: {
          dismissedBy: authorized.userId,
          dismissedAt: new Date().toISOString(),
          ...(reason ? { dismissReason: reason.slice(0, 500) } : {}),
        } as unknown as Prisma.InputJsonValue,
      },
    });
    res.json({ ok: true, id: updated.id, status: updated.status });
  } catch (err) {
    log.error("[metrics/improvements] dismiss error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

/**
 * POST /api/v1/metrics/improvements/backfill
 *
 * Manually re-run the FailureCurator over the last N days for one or all
 * agents. Useful for initial rollout (don't wait an hour for first findings)
 * or after a major prompt change (regenerate suggestions immediately).
 *
 * Body (all optional):
 *   { agentSlug?: string, days?: number  (1..30, default 7) }
 *
 * Returns a summary report — per-agent emitted counts + skipped reasons.
 * Watermark is NOT advanced; the hourly worker continues its own cadence.
 *
 * Long-running for large workspaces — sequential per chunk of CONCURRENCY=3
 * agents. Typical wall-clock at p95 ~10-30s per agent (LLM call), so 50
 * agents ≈ 3-5 min. Sync response.
 */
metricsRouter.post("/improvements/backfill", async (req: Request, res: Response) => {
  try {
    const userId = String(req.headers["x-user-id"] ?? "");
    if (!userId) { res.status(401).json({ error: "x-user-id header is required" }); return; }
    if (!(await isClawAdmin(userId))) { res.status(403).json({ error: "Admin required" }); return; }

    const body = (req.body ?? {}) as { agentSlug?: string; days?: number };
    const report = await backfillFailureCurator({
      ...(typeof body.agentSlug === "string" && body.agentSlug ? { agentSlug: body.agentSlug } : {}),
      ...(typeof body.days === "number" ? { days: body.days } : {}),
    });
    res.json(report);
  } catch (err) {
    log.error("[metrics/improvements/backfill] error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

/**
 * Build the analytics window for the deep tool endpoints below.
 *
 * The window column is not a caller preference — it is chosen so an existing
 * index can serve the scan. Agent-scoped queries use `startedAt`, matching
 * `@@index([agentSlug, startedAt])` as an exact two-column index condition;
 * unscoped queries use `completedAt`, matching
 * `@@index([completedAt, triggerSource])`. Picking the other column in either
 * case degrades to a BitmapAnd or a sequential scan.
 *
 * Agent-scoped responses therefore describe runs STARTED in the window, while
 * global ones describe runs COMPLETED in it.
 */
async function buildAnalyticsWindow(req: Request, endpoint: string): Promise<{
  window: AnalyticsWindow;
  days: number;
  agentSlugs: string[];
  sessionId: string | undefined;
}> {
  const { userFilter, orgFilter } = await resolveMetricsScope(req, endpoint);
  const { windowStart, windowEnd, days } = parseWindow(req);
  const agentSlugs = parseAgentSlugs(req);
  const sessionId = parseSessionId(req);

  return {
    days,
    agentSlugs,
    sessionId,
    window: {
      windowStart,
      windowEnd,
      // A session is one run, so the window column no longer decides the plan —
      // the unique index on sessionId does. Keep the agent-scoped choice for
      // consistency with the un-filtered case.
      windowColumn: agentSlugs.length > 0 ? "startedAt" : "completedAt",
      agentSlugs,
      ...(sessionId ? { sessionId } : {}),
      userFilter,
      orgFilter,
    },
  };
}

/**
 * Reads the agent selection from `?agentSlug=`.
 *
 * Accepts a single value, the param repeated, or one comma-separated value, so
 * the existing single-agent callers keep working verbatim while the metrics UI
 * can pass a multi-select. Deduped and capped — the cap bounds the IN list a
 * hand-edited URL can produce, not any real selection.
 */
const MAX_AGENT_FILTER = 50;

/** Page-size ceiling. Bounds the response, not the aggregation, which is per-window. */
const MAX_PAGE_LIMIT = 200;
const DEFAULT_PAGE_LIMIT = 50;

function parseIntParam(raw: unknown, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

/**
 * Reads `limit` / `offset` / `sort` / `dir` / `search`.
 *
 * `sort` is validated against the whitelist rather than passed through — the
 * value reaches an ORDER BY, and only a known key may.
 */
/**
 * Which series the tools chart should plot.
 *
 * Validated against the known sets rather than passed through — both values
 * select a SQL expression, so only a known key may reach the query.
 */
const CHART_MEASURES: readonly ChartMeasure[] = ["bytes", "time", "errors", "calls"];
const CHART_AGGREGATIONS: readonly ChartAggregation[] = ["total", "perCall", "perSession"];

function parseChartRequest(req: Request): ChartRequest {
  const measure = String(req.query["chartMeasure"] ?? "");
  const aggregation = String(req.query["chartAgg"] ?? "");
  return {
    measure: CHART_MEASURES.includes(measure as ChartMeasure) ? (measure as ChartMeasure) : "bytes",
    aggregation: CHART_AGGREGATIONS.includes(aggregation as ChartAggregation)
      ? (aggregation as ChartAggregation)
      : "total",
  };
}

function parseToolPage(req: Request): PageRequest {
  const rawSort = String(req.query["sort"] ?? "");
  const sort = (TOOL_SORT_KEYS as string[]).includes(rawSort) ? (rawSort as ToolSortKey) : "calls";
  const search = typeof req.query["search"] === "string" ? req.query["search"] : undefined;
  return {
    limit: parseIntParam(req.query["limit"], DEFAULT_PAGE_LIMIT, 1, MAX_PAGE_LIMIT),
    offset: parseIntParam(req.query["offset"], 0, 0, Number.MAX_SAFE_INTEGER),
    sort,
    dir: req.query["dir"] === "asc" ? "asc" : "desc",
    ...(search ? { search } : {}),
  };
}

function parseAgentSlugs(req: Request): string[] {
  const raw = req.query["agentSlug"];
  const values = Array.isArray(raw) ? raw : [raw];
  const slugs = values
    .filter((v): v is string => typeof v === "string")
    .flatMap((v) => v.split(","))
    .map((v) => v.trim())
    .filter(Boolean);
  return [...new Set(slugs)].slice(0, MAX_AGENT_FILTER);
}

/**
 * GET /api/v1/metrics/session/:sessionId
 *
 * The one run behind a session filter.
 *
 * The window rollups are aggregates and have no single-run form — a p95 over
 * one value is that value. So rather than telling the reader the filter does
 * not apply, this returns the run itself: what it did, how long it took, what
 * it spent, and whether the deep tabs will have anything to show for it.
 *
 * Scoped by `resolveMetricsScope`, so a non-admin sees only their own runs.
 */
metricsRouter.get("/session/:sessionId", async (req: Request<{ sessionId: string }>, res: Response) => {
  try {
    const { userFilter, orgFilter } = await resolveMetricsScope(req, "/metrics/session");
    const sessionId = req.params.sessionId?.trim();
    if (!sessionId) {
      res.status(400).json({ error: "sessionId is required" });
      return;
    }

    const [row] = await prisma.$queryRaw<Array<{
      session_id: string; agent_slug: string; status: string; trigger_source: string;
      provider: string | null; model: string | null; task: string | null; error: string | null;
      started_at: Date; completed_at: Date | null;
      total_ms: number | null; llm_total_ms: number | null; tool_ms: number | null;
      llm_turns: number | null; llm_retries: number | null; ttft_ms: number | null;
      tokens_in: number | null; tokens_out: number | null;
      tokens_cache_read: number | null; tokens_cache_write: number | null;
      tools_used: string[] | null; rating: string | null;
      tool_calls: number | null; llm_calls: number | null;
    }>>(Prisma.sql`
      SELECT
        r."sessionId" AS session_id, r."agentSlug" AS agent_slug, r.status,
        r."triggerSource" AS trigger_source, r.provider, r.model,
        left(r.task, 400) AS task, left(r.error, 400) AS error,
        r."startedAt" AS started_at, r."completedAt" AS completed_at,
        r."totalMs" AS total_ms, r."llmTotalMs" AS llm_total_ms, r."toolMs" AS tool_ms,
        r."llmTurns" AS llm_turns, r."llmRetries" AS llm_retries, r."ttftMs" AS ttft_ms,
        r."tokensIn" AS tokens_in, r."tokensOut" AS tokens_out,
        r."tokensCacheRead" AS tokens_cache_read, r."tokensCacheWrite" AS tokens_cache_write,
        r."toolsUsed" AS tools_used, r.rating,
        CASE WHEN jsonb_typeof(r."toolInvocations") = 'array'
             THEN jsonb_array_length(r."toolInvocations") END AS tool_calls,
        CASE WHEN jsonb_typeof(r."llmTurnStats") = 'array'
             THEN jsonb_array_length(r."llmTurnStats") END AS llm_calls
      FROM "agent_runs" r
      WHERE r."sessionId" = ${sessionId} ${userFilter} ${orgFilter}
      LIMIT 1
    `);

    if (!row) {
      res.status(404).json({ error: "Session not found, or not visible to you" });
      return;
    }

    res.json({
      sessionId: row.session_id,
      agentSlug: row.agent_slug,
      status: row.status,
      trigger: row.trigger_source,
      provider: row.provider,
      model: row.model,
      task: row.task,
      error: row.error,
      startedAt: row.started_at.toISOString(),
      completedAt: row.completed_at ? row.completed_at.toISOString() : null,
      totalMs: row.total_ms,
      llmTotalMs: row.llm_total_ms,
      toolMs: row.tool_ms,
      llmTurns: row.llm_turns,
      llmRetries: row.llm_retries,
      ttftMs: row.ttft_ms,
      tokens: {
        in: row.tokens_in ?? 0,
        out: row.tokens_out ?? 0,
        cacheRead: row.tokens_cache_read ?? 0,
        cacheWrite: row.tokens_cache_write ?? 0,
      },
      toolsUsed: row.tools_used ?? [],
      toolCalls: row.tool_calls,
      rating: row.rating,
      // Null means the run predates the column — the matching tab will be empty
      // for it, and the UI says so rather than showing a bare zero.
      llmCallsRecorded: row.llm_calls,
    });
  } catch (err) {
    log.error("[metrics/session] error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

/**
 * GET /api/v1/metrics/tools?days=7&agentSlug=euler
 *
 * Per-tool volume, reliability, latency and context burn, plus the top failure
 * modes for each tool. Answers "which tool is failing, which is slow, and
 * which is eating the context budget".
 */
metricsRouter.get("/tools", async (req: Request, res: Response) => {
  try {
    const { window, days, agentSlugs } = await buildAnalyticsWindow(req, "/metrics/tools");
    // `tools` and `fieldUsage` read the precomputed toolStats column (~57ms).
    // `errorClasses` stays on the live blob because grouping failure modes needs
    // the raw error text, which no fixed-shape summary can carry.
    const pageReq = parseToolPage(req);
    const [tools, coverage, errorClasses] = await Promise.all([
      fetchToolStats(window, pageReq, parseChartRequest(req)),
      fetchToolStatsCoverage(window),
      fetchToolErrorClasses(window),
    ]);
    res.json({
      days,
      agentSlug: agentSlugs.length === 1 ? agentSlugs[0]! : null,
      agentSlugs,
      windowStart: window.windowStart.toISOString(),
      windowEnd: window.windowEnd.toISOString(),
      windowColumn: window.windowColumn,
      // Below 1 means backfill is incomplete and every count here under-reports.
      coverage,
      tools: tools.rows,
      // Window-wide, never derived from the page — see ToolWindowTotals.
      totals: tools.totals,
      page: tools.page,
      // Top-N over the whole window, ranked for the requested measure and
      // aggregation, so a chart never ranks one page of rows.
      chart: tools.chart,
      chartRequest: tools.chartRequest,
      errorClasses,
    });
  } catch (err) {
    log.error("[metrics/tools] error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

/**
 * GET /api/v1/metrics/tools/quality?days=7&agentSlug=euler
 *
 * Behavioural signals: blind-retry rate, recovery-after-error rate, and
 * citation attribution.
 *
 * `citeRate` is null wherever nothing was citeable, and `citationConfig`
 * reports the two per-agent flags that govern citation coverage — both are
 * required to read the rate honestly (see lib/tool-citations.ts).
 */
metricsRouter.get("/tools/quality", async (req: Request, res: Response) => {
  try {
    const { window, days, agentSlugs } = await buildAnalyticsWindow(req, "/metrics/tools/quality");
    // `?exact=1` swaps the same-turn citation counts carried in toolStats for
    // the live conversation-scoped join, which also catches a later turn
    // re-citing an earlier turn's chunk. It costs ~3s, so it is opt-in.
    const exact = req.query["exact"] === "1" || req.query["exact"] === "true";
    const pageReq = parseToolPage(req);
    const [quality, coverage, citationReflection] = await Promise.all([
      fetchToolStats(window, pageReq),
      fetchToolStatsCoverage(window),
      fetchCitationReflection(window),
    ]);
    const citations = exact ? await fetchToolCiteRates(window) : null;
    const citationConfig = await fetchCitationConfig(agentSlugs.length > 0 ? agentSlugs : undefined);
    res.json({
      days,
      agentSlug: agentSlugs.length === 1 ? agentSlugs[0]! : null,
      agentSlugs,
      windowStart: window.windowStart.toISOString(),
      windowEnd: window.windowEnd.toISOString(),
      coverage,
      // citeRate here is same-turn scope; `citations` is populated only with
      // ?exact=1 and is the conversation-scoped figure.
      quality: quality.rows,
      totals: quality.totals,
      page: quality.page,
      citations,
      citationScope: exact ? "conversation" : "same-turn",
      citationReflection,
      citationConfig,
    });
  } catch (err) {
    log.error("[metrics/tools/quality] error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

/**
 * GET /api/v1/metrics/tools/failures?tool=search&days=7&limit=50&offset=0
 *
 * EVERY failure class for one tool, paged by frequency.
 *
 * The overview card on /metrics/tools keeps only the top few classes per tool
 * so it stays readable; that cap hides the long tail, which is where the rare
 * fatal failure lives. This is the drill-down — one tool, no rank cap.
 */
metricsRouter.get("/tools/failures", async (req: Request, res: Response) => {
  try {
    const tool = typeof req.query["tool"] === "string" ? req.query["tool"].trim() : "";
    if (!tool) {
      res.status(400).json({ error: "tool is required" });
      return;
    }
    const { window, days } = await buildAnalyticsWindow(req, "/metrics/tools/failures");
    const limit = parseIntParam(req.query["limit"], DEFAULT_PAGE_LIMIT, 1, MAX_PAGE_LIMIT);
    const offset = parseIntParam(req.query["offset"], 0, 0, Number.MAX_SAFE_INTEGER);
    const failures = await fetchToolFailures(window, tool, { limit, offset });
    res.json({
      days,
      tool,
      windowStart: window.windowStart.toISOString(),
      windowEnd: window.windowEnd.toISOString(),
      rows: failures.rows,
      occurrences: failures.occurrences,
      page: { limit, offset, total: failures.total },
    });
  } catch (err) {
    log.error("[metrics/tools/failures] error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

/**
 * GET /api/v1/metrics/tools/coverage?days=7&agentSlug=euler
 *
 * Palette and schema hygiene: granted tools never called, and declared tool
 * parameters never supplied.
 *
 * `argUsage[].schemaCovered` is false wherever no declared schema could be
 * joined; those rows still carry observed field rates but cannot report dead
 * fields. Callers must surface that distinction rather than render an empty
 * `deadFields` as "no dead fields".
 */
metricsRouter.get("/tools/coverage", async (req: Request, res: Response) => {
  try {
    const { window, days, agentSlugs } = await buildAnalyticsWindow(req, "/metrics/tools/coverage");
    const [deadTools, argUsage] = await Promise.all([
      fetchDeadTools(window),
      fetchToolArgUsage(window),
    ]);
    res.json({
      days,
      agentSlug: agentSlugs.length === 1 ? agentSlugs[0]! : null,
      agentSlugs,
      windowStart: window.windowStart.toISOString(),
      windowEnd: window.windowEnd.toISOString(),
      deadTools,
      argUsage: argUsage.rows,
      // True when more tools have argument data than were returned — the list
      // is the most-called N, not all of them.
      argUsageTruncated: argUsage.truncated,
      argUsageLimit: argUsage.limit,
    });
  } catch (err) {
    log.error("[metrics/tools/coverage] error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

/**
 * POST /api/v1/metrics/tools/backfill
 *
 * Summarise runs that predate the `toolStats` column. Until this completes,
 * every precomputed number under-reports its window — `GET /metrics/tools`
 * returns `coverage` so that shortfall is visible rather than silent.
 *
 * Chunked and resumable: it only selects rows where `toolStats IS NULL`, so
 * re-invoking continues where a previous run stopped. Admin-only, since it
 * reads every historical invocation blob.
 *
 * Body (all optional):
 *   { batchSize?: number, maxRows?: number, pauseMs?: number, sinceDays?: number }
 */
metricsRouter.post("/tools/backfill", async (req: Request, res: Response) => {
  try {
    const userId = String(req.headers["x-user-id"] ?? "");
    if (!userId) { res.status(401).json({ error: "x-user-id header is required" }); return; }
    if (!(await isClawAdmin(userId))) { res.status(403).json({ error: "Admin required" }); return; }

    const body = (req.body ?? {}) as { batchSize?: number; maxRows?: number; pauseMs?: number; sinceDays?: number };
    const report = await backfillToolStats({
      ...(typeof body.batchSize === "number" ? { batchSize: Math.min(Math.max(body.batchSize, 1), 1000) } : {}),
      ...(typeof body.maxRows === "number" ? { maxRows: body.maxRows } : {}),
      ...(typeof body.pauseMs === "number" ? { pauseMs: Math.min(Math.max(body.pauseMs, 0), 5000) } : {}),
      ...(typeof body.sinceDays === "number"
        ? { since: new Date(Date.now() - body.sinceDays * 24 * 60 * 60 * 1000) }
        : {}),
    });
    res.json(report);
  } catch (err) {
    log.error("[metrics/tools/backfill] error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

/**
 * GET /api/v1/metrics/llm-calls?days=7&agentSlug=euler&includeSubagents=1&points=1
 *
 * Per-LLM-call latency and token series for the window, plus the two rollups
 * that answer how TTFT and throughput move with prompt size and with position
 * in the agent loop.
 *
 * `byContext` excludes retried calls, whose TTFT includes an abandoned attempt.
 * `byCallIndex` keeps them and reports `retriedShare` alongside
 * `compactionShare`, because at a given index a retry is what actually
 * happened — the two shares are what stop a sawtooth or a retry spike from
 * reading as a context effect.
 *
 * Raw points are opt-in via `points=1`: unaggregated row data, bounded at 5000,
 * useful only for scatter/regression work.
 *
 * `coverage` below 1 means runs in the window predate the column. Unlike the
 * tool metrics there is no backfill — per-call timing is only observable while
 * a run executes — so early windows are permanently partial.
 */
metricsRouter.get("/llm-calls", async (req: Request, res: Response) => {
  try {
    const { window, days, agentSlugs } = await buildAnalyticsWindow(req, "/metrics/llm-calls");
    const includeSubagents = req.query["includeSubagents"] === "1" || req.query["includeSubagents"] === "true";
    const parentOnly = !includeSubagents;
    const wantPoints = req.query["points"] === "1" || req.query["points"] === "true";

    const [byContext, byCallIndex, coverage] = await Promise.all([
      fetchLlmLatencyByContext(window, parentOnly),
      fetchLlmLatencyByCallIndex(window, 40, parentOnly),
      fetchLlmStatsCoverage(window),
    ]);
    const points = wantPoints ? await fetchLlmCallSeries(window) : null;

    res.json({
      days,
      agentSlug: agentSlugs.length === 1 ? agentSlugs[0]! : null,
      agentSlugs,
      windowStart: window.windowStart.toISOString(),
      windowEnd: window.windowEnd.toISOString(),
      scope: parentOnly ? "parent" : "parent+subagents",
      coverage,
      byContext,
      byCallIndex,
      points,
    });
  } catch (err) {
    log.error("[metrics/llm-calls] error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});
