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
async function fetchToolLatency(opts: {
  windowStart: Date;
  windowEnd: Date;
  agentSlug: string;
  userFilter: Prisma.Sql;
  orgFilter: Prisma.Sql;
  limit: number;
}): Promise<ToolLatencyRow[]> {
  const rows = await prisma.$queryRaw<Array<{
    tool: string;
    calls: bigint;
    errors: bigint;
    avg_ms: number | null;
    p50_ms: number | null;
    p95_ms: number | null;
    // Postgres SUM(int) returns BIGINT — must Number() before serialising.
    total_ms: bigint | null;
  }>>`
    SELECT
      inv->>'toolName'                                                     AS tool,
      COUNT(*)                                                             AS calls,
      COUNT(*) FILTER (WHERE (inv->>'isError')::boolean)                   AS errors,
      AVG(NULLIF(inv->>'durationMs','')::int)                              AS avg_ms,
      PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY NULLIF(inv->>'durationMs','')::int) AS p50_ms,
      PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY NULLIF(inv->>'durationMs','')::int) AS p95_ms,
      SUM(NULLIF(inv->>'durationMs','')::int)                              AS total_ms
    FROM "agent_runs" r,
         LATERAL jsonb_array_elements(r."toolInvocations") inv
    WHERE r."agentSlug" = ${opts.agentSlug}
      AND r."completedAt" >= ${opts.windowStart}
      AND r."completedAt" <  ${opts.windowEnd}
      AND r."toolInvocations" IS NOT NULL
      AND NULLIF(inv->>'durationMs','') IS NOT NULL
      ${opts.userFilter}
      ${opts.orgFilter}
    GROUP BY inv->>'toolName'
    ORDER BY total_ms DESC NULLS LAST
    LIMIT ${opts.limit}
  `;
  const round = (n: number | null): number | null => (n == null ? null : Math.round(n));
  return rows.map((r) => ({
    tool: r.tool,
    calls: Number(r.calls),
    errors: Number(r.errors),
    avgMs: round(r.avg_ms),
    p50Ms: round(r.p50_ms),
    p95Ms: round(r.p95_ms),
    totalMs: r.total_ms != null ? Number(r.total_ms) : 0,
  }));
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
    const days = parseDays(req);
    const windowEnd = new Date();
    const windowStart = new Date(windowEnd.getTime() - days * 24 * 60 * 60 * 1000);
    const prevWindowStart = new Date(windowStart.getTime() - days * 24 * 60 * 60 * 1000);

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
    const days = parseDays(req);
    const windowEnd = new Date();
    const windowStart = new Date(windowEnd.getTime() - days * 24 * 60 * 60 * 1000);
    const prevWindowStart = new Date(windowStart.getTime() - days * 24 * 60 * 60 * 1000);

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
 * GET /metrics/awakening — activity for agents that wake on their own.
 *
 * Awakened runs are deliberately absent from the rest of this file's numbers:
 * they have no `userId`, so the user-scoped filters every other endpoint
 * applies would drop them, and mixing unattended runs into per-user latency
 * would skew it. They still need to be observable — an awakened agent posts in
 * public with nobody watching — so they get their own rollup.
 *
 * Three questions this answers, which is what operating the feature actually
 * requires: is it running, what is it deciding, and is anything broken.
 * Scoped by org only; there is no user dimension to scope by.
 */
metricsRouter.get("/awakening", async (req: Request, res: Response) => {
  try {
    const { orgFilter, scopeOrgId } = await resolveMetricsScope(req, "/metrics/awakening");
    const days = parseDays(req);
    const windowEnd = new Date();
    const windowStart = new Date(windowEnd.getTime() - days * 24 * 60 * 60 * 1000);

    const [totalsRaw, perDayRaw, byAgentRaw, skipRaw, statesRaw] = await Promise.all([
      prisma.$queryRaw<Array<{
        runs: bigint; ran: bigint; skipped: bigint; failed: bigint; shadow: bigint;
        injections: bigint; events: bigint;
      }>>`
        SELECT
          COUNT(*)                                        AS runs,
          COUNT(*) FILTER (WHERE outcome = 'ran')         AS ran,
          COUNT(*) FILTER (WHERE outcome = 'skipped')     AS skipped,
          COUNT(*) FILTER (WHERE outcome = 'failed')      AS failed,
          COUNT(*) FILTER (WHERE outcome = 'shadow')      AS shadow,
          COALESCE(SUM("injectionsUsed"), 0)              AS injections,
          COALESCE(SUM("eventCount"), 0)                  AS events
        FROM "agent_awakening_runs"
        WHERE "startedAt" >= ${windowStart} AND "startedAt" < ${windowEnd} ${orgFilter}
      `,
      prisma.$queryRaw<Array<{
        day: Date; ran: bigint; skipped: bigint; failed: bigint;
      }>>`
        SELECT
          date_trunc('day', "startedAt")::date            AS day,
          COUNT(*) FILTER (WHERE outcome IN ('ran','shadow')) AS ran,
          COUNT(*) FILTER (WHERE outcome = 'skipped')     AS skipped,
          COUNT(*) FILTER (WHERE outcome = 'failed')      AS failed
        FROM "agent_awakening_runs"
        WHERE "startedAt" >= ${windowStart} AND "startedAt" < ${windowEnd} ${orgFilter}
        GROUP BY 1 ORDER BY 1 ASC
      `,
      prisma.$queryRaw<Array<{
        agent_id: string; agent_slug: string | null; kind: string; runs: bigint; ran: bigint;
        skipped: bigint; failed: bigint; events: bigint; last_run_at: Date | null;
      }>>`
        SELECT
          r."agentId"                                     AS agent_id,
          a.slug                                          AS agent_slug,
          r.kind                                          AS kind,
          COUNT(*)                                        AS runs,
          COUNT(*) FILTER (WHERE r.outcome IN ('ran','shadow')) AS ran,
          COUNT(*) FILTER (WHERE r.outcome = 'skipped')   AS skipped,
          COUNT(*) FILTER (WHERE r.outcome = 'failed')    AS failed,
          COALESCE(SUM(r."eventCount"), 0)                AS events,
          MAX(r."startedAt")                              AS last_run_at
        FROM "agent_awakening_runs" r
        LEFT JOIN "agents" a ON a.id = r."agentId"
        WHERE r."startedAt" >= ${windowStart} AND r."startedAt" < ${windowEnd}
          ${scopeOrgId ? Prisma.sql`AND r."orgId" = ${scopeOrgId}` : Prisma.empty}
        GROUP BY 1, 2, 3
        ORDER BY runs DESC
        LIMIT 50
      `,
      prisma.$queryRaw<Array<{ reason: string | null; count: bigint }>>`
        SELECT "skipReason" AS reason, COUNT(*) AS count
        FROM "agent_awakening_runs"
        WHERE "startedAt" >= ${windowStart} AND "startedAt" < ${windowEnd}
          AND outcome = 'skipped' ${orgFilter}
        GROUP BY 1 ORDER BY count DESC LIMIT 20
      `,
      // Current health, independent of the window: an agent the workers switched
      // off has no recent runs BY DEFINITION, so it would be invisible above.
      prisma.$queryRaw<Array<{
        agent_slug: string | null; enabled: boolean; last_error: string | null;
        next_due_at: Date | null; reflex_next_check_at: Date | null;
        consecutive_failures: number;
      }>>`
        SELECT
          a.slug                    AS agent_slug,
          s.enabled                 AS enabled,
          s."lastError"             AS last_error,
          s."nextDueAt"             AS next_due_at,
          s."reflexNextCheckAt"     AS reflex_next_check_at,
          s."consecutiveFailures"   AS consecutive_failures
        FROM "agent_awakening_state" s
        LEFT JOIN "agents" a ON a.id = s."agentId"
        WHERE TRUE ${scopeOrgId ? Prisma.sql`AND s."orgId" = ${scopeOrgId}` : Prisma.empty}
        ORDER BY s.enabled DESC, a.slug ASC
        LIMIT 100
      `,
    ]);

    const t = totalsRaw[0];
    res.json({
      days,
      totals: {
        runs: Number(t?.runs ?? 0),
        ran: Number(t?.ran ?? 0),
        skipped: Number(t?.skipped ?? 0),
        failed: Number(t?.failed ?? 0),
        shadow: Number(t?.shadow ?? 0),
        injections: Number(t?.injections ?? 0),
        events: Number(t?.events ?? 0),
      },
      perDay: perDayRaw.map((r) => ({
        day: r.day.toISOString().slice(0, 10),
        ran: Number(r.ran),
        skipped: Number(r.skipped),
        failed: Number(r.failed),
      })),
      byAgent: byAgentRaw.map((r) => ({
        agentId: r.agent_id,
        agentSlug: r.agent_slug ?? "(deleted agent)",
        kind: r.kind,
        runs: Number(r.runs),
        ran: Number(r.ran),
        skipped: Number(r.skipped),
        failed: Number(r.failed),
        events: Number(r.events),
        lastRunAt: r.last_run_at ? r.last_run_at.toISOString() : null,
      })),
      skipReasons: skipRaw.map((r) => ({
        reason: r.reason ?? "(unspecified)",
        count: Number(r.count),
      })),
      agents: statesRaw.map((r) => ({
        agentSlug: r.agent_slug ?? "(deleted agent)",
        enabled: r.enabled,
        lastError: r.last_error,
        nextDueAt: r.next_due_at ? r.next_due_at.toISOString() : null,
        reflexNextCheckAt: r.reflex_next_check_at ? r.reflex_next_check_at.toISOString() : null,
        consecutiveFailures: Number(r.consecutive_failures ?? 0),
      })),
    });
  } catch (err) {
    log.error("[metrics/awakening] error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

/**
 * GET /metrics/awakening/:agentId/runs — one agent's wake history, paginated.
 *
 * The drill-down behind the Awakened agents section. Every wake ATTEMPT is a
 * row here, not just the ones that acted, because "why did it stay quiet" is
 * the question operators actually have — `skipReason` carries the gate rule
 * that fired.
 *
 * `conversationId` is joined from agent_runs so each acting wake links straight
 * to the transcript; a skipped wake never dispatched one and has none.
 *
 * `kind` narrows to heartbeat or reflex. The rollup above lists one row PER
 * WAKE KIND, so drilling into an agent's heartbeat row must not return its
 * reflex wakes as well.
 */
metricsRouter.get("/awakening/:agentId/runs", async (req: Request<{ agentId: string }>, res: Response) => {
  try {
    const { scopeOrgId } = await resolveMetricsScope(req, "/metrics/awakening/runs");
    const { agentId } = req.params;
    const days = parseDays(req);
    const windowEnd = new Date();
    const windowStart = new Date(windowEnd.getTime() - days * 24 * 60 * 60 * 1000);

    const limit = Math.min(Math.max(Number(req.query["limit"]) || 20, 1), 100);
    const offset = Math.max(Number(req.query["offset"]) || 0, 0);

    // Org scoping is applied to the RUN rows, not just the agent, so an admin
    // scoped to one org cannot page through another org's history by id.
    const scope = scopeOrgId ? Prisma.sql`AND r."orgId" = ${scopeOrgId}` : Prisma.empty;

    const kindRaw = String(req.query["kind"] ?? "");
    const kindFilter = kindRaw === "heartbeat" || kindRaw === "reflex"
      ? Prisma.sql`AND r.kind = ${kindRaw}`
      : Prisma.empty;

    const [rowsRaw, countRaw] = await Promise.all([
      prisma.$queryRaw<Array<{
        id: string; kind: string; outcome: string; skip_reason: string | null;
        event_count: number; injections_used: number; session_id: string | null;
        conversation_id: string | null; run_status: string | null;
        window_start_ms: bigint; window_end_ms: bigint;
        started_at: Date; completed_at: Date | null;
      }>>`
        SELECT
          r.id                AS id,
          r.kind              AS kind,
          r.outcome           AS outcome,
          r."skipReason"      AS skip_reason,
          r."eventCount"      AS event_count,
          r."injectionsUsed"  AS injections_used,
          r."sessionId"       AS session_id,
          ar."conversationId" AS conversation_id,
          ar.status           AS run_status,
          r."windowStartMs"   AS window_start_ms,
          r."windowEndMs"     AS window_end_ms,
          r."startedAt"       AS started_at,
          r."completedAt"     AS completed_at
        FROM "agent_awakening_runs" r
        LEFT JOIN "agent_runs" ar ON ar."sessionId" = r."sessionId"
        WHERE r."agentId" = ${agentId}
          AND r."startedAt" >= ${windowStart} AND r."startedAt" < ${windowEnd}
          ${scope} ${kindFilter}
        ORDER BY r."startedAt" DESC
        LIMIT ${limit} OFFSET ${offset}
      `,
      prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) AS count
        FROM "agent_awakening_runs" r
        WHERE r."agentId" = ${agentId}
          AND r."startedAt" >= ${windowStart} AND r."startedAt" < ${windowEnd}
          ${scope} ${kindFilter}
      `,
    ]);

    res.json({
      total: Number(countRaw[0]?.count ?? 0),
      limit,
      offset,
      runs: rowsRaw.map((r) => ({
        id: r.id,
        kind: r.kind,
        outcome: r.outcome,
        skipReason: r.skip_reason,
        eventCount: Number(r.event_count ?? 0),
        injectionsUsed: Number(r.injections_used ?? 0),
        sessionId: r.session_id,
        conversationId: r.conversation_id,
        runStatus: r.run_status,
        windowStartMs: Number(r.window_start_ms),
        windowEndMs: Number(r.window_end_ms),
        startedAt: r.started_at.toISOString(),
        completedAt: r.completed_at ? r.completed_at.toISOString() : null,
        durationMs: r.completed_at ? r.completed_at.getTime() - r.started_at.getTime() : null,
      })),
    });
  } catch (err) {
    log.error("[metrics/awakening/runs] error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});
