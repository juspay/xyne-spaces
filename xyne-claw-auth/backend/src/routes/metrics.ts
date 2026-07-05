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
import { isClawAdmin } from "../middleware/agent-acl.js";
import { backfillFailureCurator } from "../services/failure-curator-worker.js";

import { createLogger } from "../logger.js";
const log = createLogger("metrics");

/**
 * Per-request user scope. Admins see the full workspace; everyone else only
 * sees runs they personally triggered. The returned `userFilter` is a
 * Prisma.sql fragment ready to drop into any agent_runs query — empty when
 * admin, `AND "userId" = '<uid>'` otherwise. Encapsulated so every route
 * applies the same rule consistently.
 */
async function resolveUserScope(req: Request): Promise<{ userId: string; userFilter: Prisma.Sql; scopeUserId: string | undefined }> {
  const userId = String(req.headers["x-user-id"] ?? "");
  if (!userId) throw new Error("x-user-id header is required");
  const admin = await isClawAdmin(userId);
  return {
    userId,
    userFilter: admin ? Prisma.empty : Prisma.sql`AND "userId" = ${userId}`,
    scopeUserId: admin ? undefined : userId,
  };
}

export const metricsRouter = Router();

const ALLOWED_DAYS = new Set([1, 7, 30]);
const DEFAULT_DAYS = 7;

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
}

interface AgentRow {
  agentSlug: string;
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
  limit: number;
}): Promise<SlowSession[]> {
  const rows = await prisma.agentRun.findMany({
    where: {
      completedAt: { gte: opts.windowStart, lt: opts.windowEnd },
      totalMs: { not: null },
      ...(opts.agentSlug ? { agentSlug: opts.agentSlug } : {}),
      ...(opts.scopeUserId ? { userId: opts.scopeUserId } : {}),
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
  };
  delta: {
    runs: number;       // current - previous (raw)
    p50TotalMs: number | null;
    p95TotalMs: number | null;
    errorRate: number;
  };
  perDay: DayBucket[];
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
    const { userFilter, scopeUserId } = await resolveUserScope(req);
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
        ${userFilter}
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
    }>>`
      SELECT
        COUNT(*)                                       AS runs,
        COUNT(*) FILTER (WHERE status = 'completed')   AS completed,
        COUNT(*) FILTER (WHERE status = 'failed')      AS failed,
        COUNT(*) FILTER (WHERE status = 'cancelled')   AS cancelled,
        PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY "totalMs")    AS p50_total_ms,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY "totalMs")    AS p95_total_ms,
        AVG("llmTotalMs")                              AS avg_llm_ms,
        AVG("toolMs")                                  AS avg_tool_ms,
        AVG("llmTurns")                                AS avg_turns,
        AVG("tokensPerSec")                            AS avg_tps
      FROM "agent_runs"
      WHERE "agentSlug" = ${slug}
        AND "completedAt" >= ${windowStart}
        AND "completedAt" <  ${windowEnd}
        ${userFilter}
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
      slowSessions: await fetchSlowSessions({ windowStart, windowEnd, agentSlug: slug, scopeUserId, limit: 20 }),
      toolLatency:  await fetchToolLatency({ windowStart, windowEnd, agentSlug: slug, userFilter, limit: 30 }),
      sentiment:    await fetchSentiment({ windowStart, windowEnd, agentSlug: slug, userFilter }),
    });
  } catch (err) {
    log.error("[metrics/agent] error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
});

metricsRouter.get("/global", async (req: Request, res: Response) => {
  try {
    const { userFilter, scopeUserId } = await resolveUserScope(req);
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
        ${userFilter}
      GROUP BY 1
      ORDER BY 1 ASC
    `;

    // Per-agent leaderboard, top 20 by runs.
    const topAgentsRaw = await prisma.$queryRaw<Array<{
      agentSlug: string;
      runs: bigint;
      p50_total_ms: number | null;
      p95_total_ms: number | null;
      avg_llm_ms: number | null;
      avg_tool_ms: number | null;
      errors: bigint;
    }>>`
      SELECT
        "agentSlug",
        COUNT(*)                                                   AS runs,
        PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY "totalMs")    AS p50_total_ms,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY "totalMs")    AS p95_total_ms,
        AVG("llmTotalMs")                                          AS avg_llm_ms,
        AVG("toolMs")                                              AS avg_tool_ms,
        COUNT(*) FILTER (WHERE status IN ('failed','cancelled'))   AS errors
      FROM "agent_runs"
      WHERE "completedAt" >= ${windowStart}
        AND "completedAt" <  ${windowEnd}
        ${userFilter}
      GROUP BY "agentSlug"
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
        AND provider IS NOT NULL
        ${userFilter}
      GROUP BY provider, model
      ORDER BY runs DESC, provider ASC, model ASC NULLS LAST
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
    }>>`
      SELECT
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
        ${userFilter}
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
    `;

    const round = (n: number | null): number | null => (n == null ? null : Math.round(n));

    const t = totalsRaw[0];
    const totalsRuns = t ? Number(t.runs) : 0;
    const totalsErrors = t ? Number(t.failed) + Number(t.cancelled) : 0;
    const p = prevRaw[0];
    const prevRuns = p ? Number(p.runs) : 0;
    const prevErrors = p ? Number(p.errors) : 0;

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
      topAgents: topAgentsRaw.map((r) => {
        const runs = Number(r.runs);
        return {
          agentSlug: r.agentSlug,
          runs,
          p50TotalMs: round(r.p50_total_ms ?? null),
          p95TotalMs: round(r.p95_total_ms ?? null),
          avgLlmMs: round(r.avg_llm_ms ?? null),
          avgToolMs: round(r.avg_tool_ms ?? null),
          errorRate: runs > 0 ? Number(r.errors) / runs : 0,
        };
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
      slowSessions: await fetchSlowSessions({ windowStart, windowEnd, scopeUserId, limit: 20 }),
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

async function authorizeAgentEdit(req: Request, res: Response, agentSlug: string): Promise<string | null> {
  const userId = String(req.headers["x-user-id"] ?? "");
  if (!userId) { res.status(401).json({ error: "x-user-id header is required" }); return null; }
  const agent = await prisma.agent.findUnique({
    where: { slug: agentSlug },
    select: { id: true, ownerUserId: true },
  });
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return null; }
  const admin = await isClawAdmin(userId);
  if (admin) return userId;
  if (agent.ownerUserId === userId) return userId;
  const share = await prisma.agentShare.findUnique({
    where: { agentId_userId: { agentId: agent.id, userId } },
    select: { role: true },
  });
  if (share && (share.role === "EDITOR" || share.role === "CONTRIBUTOR")) return userId;
  res.status(403).json({ error: "Only the agent owner, contributors, or an admin can perform this action" });
  return null;
}

metricsRouter.get("/agent/:slug/improvements", async (req: Request<{ slug: string }>, res: Response) => {
  try {
    if (!(await authorizeAgentEdit(req, res, req.params.slug))) return;
    const slug = req.params.slug;
    const candidates = await prisma.agentImprovementCandidate.findMany({
      where: { agentSlug: slug, status: "pending" },
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
      select: { agentSlug: true },
    });
    if (!candidate) { res.status(404).json({ error: "Candidate not found" }); return; }
    const editorUid = await authorizeAgentEdit(req, res, candidate.agentSlug);
    if (!editorUid) return;
    const updated = await prisma.agentImprovementCandidate.update({
      where: { id: req.params.id },
      data: {
        status: "applied",
        metadata: { appliedBy: editorUid, appliedAt: new Date().toISOString() } as unknown as Prisma.InputJsonValue,
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
      select: { agentSlug: true },
    });
    if (!candidate) { res.status(404).json({ error: "Candidate not found" }); return; }
    const editorUid = await authorizeAgentEdit(req, res, candidate.agentSlug);
    if (!editorUid) return;
    const reason = String((req.body ?? {})["reason"] ?? "");
    const updated = await prisma.agentImprovementCandidate.update({
      where: { id: req.params.id },
      data: {
        status: "dismissed",
        metadata: {
          dismissedBy: editorUid,
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
