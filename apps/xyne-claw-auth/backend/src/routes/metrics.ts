/**
 * Run-level metrics for the v3 Metrics page, the agent tools and apps/dashboard.
 * One cached block per card (lib/run-analytics.ts); the legacy GET /global and
 * /agent/:slug keep their historical shapes but compose the same blocks, so they
 * agree with the v3 cards. Tool, LLM-call and session endpoints live in
 * routes/metrics-tools.ts.
 */

import { Router, type Request, type Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { isClawAdmin, getOrgId } from "../middleware/agent-acl.js";
import { getRequesterAliases } from "../middleware/pin-user-id-param.js";
import { backfillFailureCurator } from "../services/failure-curator-worker.js";
import { fetchToolRollup } from "../lib/tool-analytics.js";
import { fetchMetricSessions } from "../lib/metric-sessions.js";
import {
  boundedAll,
  fetchActiveAgents,
  fetchAgentLeaderboard,
  fetchRouteTable,
  fetchJudgeSummary,
  fetchRunDaily,
  fetchRunSummary,
  fetchSentiment,
  type AgentLeaderRow,
  type AgentSentiment,
  type DailyPoint,
  type RouteRow,
  type SummaryFigures,
  type TriggerRow as RunTriggerRow,
} from "../lib/run-analytics.js";
import {
  METRIC_TTL,
  cachedMetric,
  parseDays,
  parseIntParam,
  parseTz,
  resolveRequestWindow,
  windowInfo,
  type AnalyticsWindow,
  type MetricsDays,
  type MetricsScope,
  type TriggerGroup,
} from "../lib/metrics-core.js";

import { createLogger } from "../logger.js";
const log = createLogger("metrics");

/** Destructuring shape the awakening handlers below use; scope rules live in resolveRequestWindow. */
async function resolveMetricsScope(req: Request, endpoint: string): Promise<{
  userId: string;
  userFilter: Prisma.Sql;
  orgFilter: Prisma.Sql;
  scopeUserId: string | undefined;
  scopeOrgId: string | undefined;
  allOrgs: boolean;
}> {
  const { window, scope } = await resolveRequestWindow(req, endpoint);
  return {
    userId: scope.requesterId,
    userFilter: window.userFilter,
    orgFilter: window.orgFilter,
    scopeUserId: window.userId,
    scopeOrgId: window.orgId,
    allOrgs: window.allOrgs,
  };
}

export const metricsRouter = Router();

const CACHE_CONTROL = "private, max-age=30";

/** Shared by the card routes and the legacy composites so both hit one cache entry. */
const KEY = {
  summary: "summary",
  daily: "runs/daily",
  agentsTop: "agents/top",
  agentsActive: "agents/active",
  routes: "routes",
  judge: "judge",
  sentiment: "sentiment",
  toolRollup: "tools/rollup",
  legacySlow: "legacy/slow-sessions",
} as const;

const ACTIVE_AGENTS_TTL_MS = 5 * 60_000;
const ACTIVE_AGENTS_DAYS: MetricsDays = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TOP_AGENTS = 20;
const MAX_TOP_AGENTS = 100;

function sendError(res: Response, tag: string, err: unknown): void {
  const message = err instanceof Error ? err.message : "Internal server error";
  const status = message === "x-user-id header is required" ? 401 : message === "orgId is required" ? 400 : 500;
  if (status === 500) log.error(`[metrics${tag}] error:`, err);
  res.status(status).json({ error: message });
}

const summaryBlock = (w: AnalyticsWindow) => cachedMetric({ endpoint: KEY.summary, window: w }, METRIC_TTL.current, () => fetchRunSummary(w));
const dailyBlock = (w: AnalyticsWindow, tz: string) =>
  cachedMetric({ endpoint: KEY.daily, window: w, params: { tz } }, METRIC_TTL.current, () => fetchRunDaily(w, tz));
const agentsTopBlock = (w: AnalyticsWindow, limit: number) =>
  cachedMetric({ endpoint: KEY.agentsTop, window: w, params: { limit } }, METRIC_TTL.current, () => fetchAgentLeaderboard(w, limit));
const routesBlock = (w: AnalyticsWindow) => cachedMetric({ endpoint: KEY.routes, window: w }, METRIC_TTL.current, () => fetchRouteTable(w));
const judgeBlock = (w: AnalyticsWindow) => cachedMetric({ endpoint: KEY.judge, window: w }, METRIC_TTL.current, () => fetchJudgeSummary(w));
const sentimentBlock = (w: AnalyticsWindow) => cachedMetric({ endpoint: KEY.sentiment, window: w }, METRIC_TTL.current, () => fetchSentiment(w));

/** GET /summary — headline figures for the window and the previous window of equal length. */
metricsRouter.get("/summary", async (req: Request, res: Response) => {
  try {
    const { window, scope, days, agentSlugs } = await resolveRequestWindow(req, "/metrics/summary");
    const { value, cached } = await summaryBlock(window);
    res.set("Cache-Control", CACHE_CONTROL).json({ window: windowInfo(window, scope, days, agentSlugs, cached), ...value });
  } catch (err) {
    sendError(res, "/summary", err);
  }
});

/** GET /runs/daily?tz= — zero-filled calendar days in `tz`, plus the trigger breakdown. */
metricsRouter.get("/runs/daily", async (req: Request, res: Response) => {
  try {
    const { window, scope, days, agentSlugs } = await resolveRequestWindow(req, "/metrics/runs/daily");
    const tz = parseTz(req);
    const { value, cached } = await dailyBlock(window, tz);
    res.set("Cache-Control", CACHE_CONTROL).json({ window: windowInfo(window, scope, days, agentSlugs, cached), tz, ...value });
  } catch (err) {
    sendError(res, "/runs/daily", err);
  }
});

/** GET /agents/top?limit=20 — agent leaderboard by runs. */
metricsRouter.get("/agents/top", async (req: Request, res: Response) => {
  try {
    const { window, scope, days, agentSlugs } = await resolveRequestWindow(req, "/metrics/agents/top");
    const limit = parseIntParam(req.query["limit"], DEFAULT_TOP_AGENTS, 1, MAX_TOP_AGENTS);
    const { value, cached } = await agentsTopBlock(window, limit);
    res.set("Cache-Control", CACHE_CONTROL).json({ window: windowInfo(window, scope, days, agentSlugs, cached), rows: value });
  } catch (err) {
    sendError(res, "/agents/top", err);
  }
});

/** GET /agents/active — agents with a finished run in the last 30 days whatever the page's range, for the agent picker. */
metricsRouter.get("/agents/active", async (req: Request, res: Response) => {
  try {
    const { window: base, scope } = await resolveRequestWindow(req, "/metrics/agents/active");
    const window: AnalyticsWindow = {
      ...base,
      windowStart: new Date(base.windowEnd.getTime() - ACTIVE_AGENTS_DAYS * DAY_MS),
      agentSlugs: [],
    };
    const { value, cached } = await cachedMetric({ endpoint: KEY.agentsActive, window }, ACTIVE_AGENTS_TTL_MS, () => fetchActiveAgents(window));
    res.set("Cache-Control", CACHE_CONTROL).json({ window: windowInfo(window, scope, ACTIVE_AGENTS_DAYS, [], cached), agents: value });
  } catch (err) {
    sendError(res, "/agents/active", err);
  }
});

/** GET /routes — run-level route (agent_runs.provider) x model table. */
metricsRouter.get("/routes", async (req: Request, res: Response) => {
  try {
    const { window, scope, days, agentSlugs } = await resolveRequestWindow(req, "/metrics/routes");
    const { value, cached } = await routesBlock(window);
    res.set("Cache-Control", CACHE_CONTROL).json({ window: windowInfo(window, scope, days, agentSlugs, cached), rows: value });
  } catch (err) {
    sendError(res, "/routes", err);
  }
});

metricsRouter.get("/judge", async (req: Request, res: Response) => {
  try {
    const { window, scope, days, agentSlugs } = await resolveRequestWindow(req, "/metrics/judge");
    const { value, cached } = await judgeBlock(window);
    res.set("Cache-Control", CACHE_CONTROL).json({ window: windowInfo(window, scope, days, agentSlugs, cached), rows: value });
  } catch (err) {
    sendError(res, "/judge", err);
  }
});

/** GET /sentiment?agentSlug=<one> — ratings, behavioural rates and memory recall for ONE agent. */
metricsRouter.get("/sentiment", async (req: Request, res: Response) => {
  try {
    const { window, scope, days, agentSlugs } = await resolveRequestWindow(req, "/metrics/sentiment");
    if (agentSlugs.length !== 1) {
      res.status(400).json({ error: "sentiment needs exactly one agentSlug" });
      return;
    }
    const { value, cached } = await sentimentBlock(window);
    res.set("Cache-Control", CACHE_CONTROL).json({ window: windowInfo(window, scope, days, agentSlugs, cached), ...value });
  } catch (err) {
    sendError(res, "/sentiment", err);
  }
});

/** Always present, in this order; newer groups follow only when non-zero. */
const LEGACY_TRIGGER_GROUPS = ["user", "automation", "scheduled", "api"] as const;

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
  [group: string]: string | number | null | undefined;
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

interface ToolLatencyRow {
  tool: string;
  calls: number;
  errors: number;
  avgMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  totalMs: number;
  droppedEnd: number;
  droppedEndRate: number;
}

interface HeadlineFigures {
  runsWithTokens: number;
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheWrite: number;
  avgTokensInPerRun: number | null;
  avgTokensOutPerRun: number | null;
  cacheHitRate: number | null;
  p50TtftMs: number | null;
  p95TtftMs: number | null;
  avgTokensPerSec: number | null;
  toolCalls: number;
  toolErrors: number;
  toolErrorRate: number | null;
}

interface MetricsHeadline extends HeadlineFigures {
  /** The previous window of equal length; null when it has no runs. */
  previous: HeadlineFigures | null;
}

interface LegacyTotals {
  runs: number;
  completed: number;
  failed: number;
  cancelled: number;
  p50TotalMs: number | null;
  p95TotalMs: number | null;
  avgLlmMs: number | null;
  avgToolMs: number | null;
  errorRate: number;
  tokens: { in: number; out: number; cacheRead: number; cacheWrite: number };
  uniqueUsers: number;
}

interface LegacyDelta {
  runs: number;       // current - previous (raw)
  p50TotalMs: number | null;
  p95TotalMs: number | null;
  errorRate: number;
}

interface MetricsResponse {
  days: number;
  windowStart: string;
  windowEnd: string;
  totals: LegacyTotals;
  delta: LegacyDelta;
  perDay: DayBucket[];
  byTrigger: TriggerRow[];
  topAgents: AgentRow[];
  byProvider: ProviderRow[];
  slowSessions: SlowSession[];
  headline: MetricsHeadline;
}

/** Failed + cancelled share, 0 on an empty window: the legacy definition. */
const legacyErrorRate = (runs: number, completed: number): number => (runs > 0 ? (runs - completed) / runs : 0);

// Legacy run time is the end-to-end wall clock, the same figure the v3 headline shows.
function legacyTotals(s: SummaryFigures): LegacyTotals {
  return {
    runs: s.runs,
    completed: s.completed,
    failed: s.failed,
    cancelled: s.cancelled,
    p50TotalMs: s.wall.p50Ms,
    p95TotalMs: s.wall.p95Ms,
    avgLlmMs: s.agent.avgLlmMs,
    avgToolMs: s.agent.avgToolMs,
    errorRate: legacyErrorRate(s.runs, s.completed),
    tokens: { in: s.tokens.freshTotal, out: s.tokens.outputTotal, cacheRead: s.tokens.cacheReadTotal, cacheWrite: s.tokens.cacheWriteTotal },
    uniqueUsers: s.users,
  };
}

function legacyDelta(cur: SummaryFigures, prev: SummaryFigures | null): LegacyDelta {
  const diff = (a: number | null, b: number | null | undefined): number | null => (a != null && b != null ? Math.round(a - b) : null);
  return {
    runs: cur.runs - (prev?.runs ?? 0),
    p50TotalMs: diff(cur.wall.p50Ms, prev?.wall.p50Ms),
    p95TotalMs: diff(cur.wall.p95Ms, prev?.wall.p95Ms),
    errorRate: legacyErrorRate(cur.runs, cur.completed) - (prev ? legacyErrorRate(prev.runs, prev.completed) : 0),
  };
}

function headlineFigures(s: SummaryFigures): HeadlineFigures {
  return {
    runsWithTokens: s.tokens.n,
    tokensIn: s.tokens.freshTotal,
    tokensOut: s.tokens.outputTotal,
    cacheRead: s.tokens.cacheReadTotal,
    cacheWrite: s.tokens.cacheWriteTotal,
    avgTokensInPerRun: s.tokens.freshPerRun,
    avgTokensOutPerRun: s.tokens.outputPerRun,
    cacheHitRate: s.tokens.cacheHitRate,
    p50TtftMs: s.replyStart.p50Ms,
    p95TtftMs: s.replyStart.p95Ms,
    avgTokensPerSec: s.throughput.tokensPerSec,
    toolCalls: s.tools.calls,
    toolErrors: s.tools.errors,
    toolErrorRate: s.tools.errorRate,
  };
}

const legacyHeadline = (cur: SummaryFigures, prev: SummaryFigures | null): MetricsHeadline =>
  ({ ...headlineFigures(cur), previous: prev ? headlineFigures(prev) : null });

function legacyDay(p: DailyPoint, withTriggers: boolean): DayBucket {
  const bucket: DayBucket = {
    day: p.day,
    runs: p.runs,
    completed: p.completed,
    failed: p.failed,
    cancelled: p.cancelled,
    p50TotalMs: p.wall.p50Ms,
    p95TotalMs: p.wall.p95Ms,
    avgLlmMs: p.agent.avgLlmMs,
    avgToolMs: p.agent.avgToolMs,
    errorRate: legacyErrorRate(p.runs, p.completed),
  };
  if (!withTriggers) return bucket;
  for (const g of LEGACY_TRIGGER_GROUPS) bucket[g] = p.byTrigger[g] ?? 0;
  for (const [g, n] of Object.entries(p.byTrigger)) if (!(g in bucket) && n) bucket[g] = n;
  return bucket;
}

function legacyTriggers(rows: RunTriggerRow[]): TriggerRow[] {
  const byGroup = new Map(rows.map((r) => [r.group, r]));
  const toLegacy = (group: TriggerGroup): TriggerRow => {
    const r = byGroup.get(group);
    return {
      trigger: group,
      runs: r?.runs ?? 0,
      completed: r?.completed ?? 0,
      failed: r?.failed ?? 0,
      cancelled: r?.cancelled ?? 0,
      errorRate: r ? legacyErrorRate(r.runs, r.completed) : 0,
      p50TotalMs: r?.wall.p50Ms ?? null,
      p95TotalMs: r?.wall.p95Ms ?? null,
    };
  };
  const extra = rows.map((r) => r.group).filter((g) => !(LEGACY_TRIGGER_GROUPS as readonly string[]).includes(g)).sort();
  return [...LEGACY_TRIGGER_GROUPS, ...extra].map(toLegacy);
}

const legacyAgent = (r: AgentLeaderRow): AgentRow => ({
  agentSlug: r.agentSlug,
  orgId: r.orgId,
  orgName: r.orgName ?? r.orgId,
  runs: r.runs,
  p50TotalMs: r.wall.p50Ms,
  p95TotalMs: r.wall.p95Ms,
  avgLlmMs: r.agent.avgLlmMs,
  avgToolMs: r.agent.avgToolMs,
  errorRate: r.successRate == null ? 0 : 1 - r.successRate,
});

const legacyProvider = (r: RouteRow): ProviderRow => ({
  provider: r.route,
  model: r.model,
  runs: r.runs,
  p50LlmMs: r.llm.p50Ms,
  p95LlmMs: r.llm.p95Ms,
  p50TtftMs: r.replyStart.p50Ms,
  p95TtftMs: r.replyStart.p95Ms,
  avgTokensPerSec: r.tokensPerSec,
  errorRate: r.errorRate ?? 0,
});

const LEGACY_SLOW_LIMIT = 20;
const LEGACY_TOOL_LATENCY_LIMIT = 30;

/** Slowest runs via the shared sessions lib; cached per viewer because redaction depends on the requester's aliases. */
async function legacySlowSessions(req: Request, w: AnalyticsWindow, scope: MetricsScope): Promise<SlowSession[]> {
  const aliases = getRequesterAliases(req).sort();
  const { value } = await cachedMetric(
    { endpoint: KEY.legacySlow, window: w, params: { viewer: aliases, limit: LEGACY_SLOW_LIMIT } },
    METRIC_TTL.current,
    () => fetchMetricSessions(w, { kind: "slow", limit: LEGACY_SLOW_LIMIT }, { requesterAliases: aliases, isAdmin: scope.isAdmin }),
  );
  return value.rows.map((r) => ({
    sessionId: r.sessionId,
    agentSlug: r.agentSlug,
    totalMs: r.totalMs,
    llmTotalMs: r.split?.llmMs ?? null,
    toolMs: r.split?.toolMs ?? null,
    completedAt: r.completedAt ?? r.startedAt,
    task: r.task ? r.task.slice(0, 240) : null,
    topTools: (r.split?.topTools ?? []).map((t) => ({ tool: t.tool, ms: t.ms, calls: t.calls, isError: t.errored })),
  }));
}

/** Per-tool latency ordered by cumulative time. */
async function legacyToolLatency(w: AnalyticsWindow): Promise<ToolLatencyRow[]> {
  const { value } = await cachedMetric({ endpoint: KEY.toolRollup, window: w }, METRIC_TTL.current, () => fetchToolRollup(w));
  return [...value.rows]
    .sort((a, b) => b.totalMs - a.totalMs)
    .slice(0, LEGACY_TOOL_LATENCY_LIMIT)
    .map((t) => ({
      tool: t.tool,
      calls: t.calls,
      errors: t.errors,
      avgMs: t.avgMs,
      p50Ms: t.p50Ms,
      p95Ms: t.p95Ms,
      totalMs: t.totalMs,
      droppedEnd: t.dropped,
      droppedEndRate: t.droppedRate ?? 0,
    }));
}

/** GET /agent/:slug — legacy shape (apps/dashboard): /global for one agent plus tool latency, sentiment and memory recall. */
metricsRouter.get("/agent/:slug", async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const { window: base, scope } = await resolveRequestWindow(req, "/metrics/agent");
    const slug = req.params.slug;
    const days = parseDays(req);
    const w: AnalyticsWindow = { ...base, agentSlugs: [slug] };
    const tz = parseTz(req);

    // The summary alone runs three statements; the rest follow so a request holds at most three connections.
    const { value: summary } = await summaryBlock(w);
    const [daily, slowSessions, toolLatency, sentiment] = await boundedAll<unknown>([
      async () => (await dailyBlock(w, tz)).value,
      () => legacySlowSessions(req, w, scope),
      () => legacyToolLatency(w),
      async () => (await sentimentBlock(w)).value,
    ]) as [Awaited<ReturnType<typeof fetchRunDaily>>, SlowSession[], ToolLatencyRow[], Awaited<ReturnType<typeof fetchSentiment>>];

    const cur = summary.current;
    const sentimentShape: AgentSentiment = sentiment.sentiment;
    res.set("Cache-Control", CACHE_CONTROL).json({
      agentSlug: slug,
      days,
      windowStart: w.windowStart.toISOString(),
      windowEnd: w.windowEnd.toISOString(),
      totals: {
        ...legacyTotals(cur),
        avgTurns: cur.llm.avgTurns,
        avgTokensPerSec: cur.throughput.tokensPerSec,
        memoryRecall: { runsWithRecall: sentiment.memoryRecall.recalled, rate: sentiment.memoryRecall.rate ?? 0 },
      },
      delta: legacyDelta(cur, summary.previous),
      perDay: daily.days.map((d) => legacyDay(d, false)),
      slowSessions,
      toolLatency,
      sentiment: sentimentShape,
      headline: legacyHeadline(cur, summary.previous),
    });
  } catch (err) {
    sendError(res, "/agent", err);
  }
});

/** GET /global — legacy shape (apps/dashboard): workspace run-level rollup. */
metricsRouter.get("/global", async (req: Request, res: Response) => {
  try {
    const { window: w, scope } = await resolveRequestWindow(req, "/metrics/global");
    const days = parseDays(req);
    const tz = parseTz(req);

    const { value: summary } = await summaryBlock(w);
    const [daily, topAgents, routes, slowSessions] = await boundedAll<unknown>([
      async () => (await dailyBlock(w, tz)).value,
      async () => (await agentsTopBlock(w, DEFAULT_TOP_AGENTS)).value,
      async () => (await routesBlock(w)).value,
      () => legacySlowSessions(req, w, scope),
    ]) as [Awaited<ReturnType<typeof fetchRunDaily>>, AgentLeaderRow[], RouteRow[], SlowSession[]];

    const response: MetricsResponse = {
      days,
      windowStart: w.windowStart.toISOString(),
      windowEnd: w.windowEnd.toISOString(),
      totals: legacyTotals(summary.current),
      delta: legacyDelta(summary.current, summary.previous),
      perDay: daily.days.map((d) => legacyDay(d, true)),
      byTrigger: legacyTriggers(daily.triggers),
      topAgents: topAgents.map(legacyAgent),
      byProvider: routes.map(legacyProvider),
      slowSessions,
      headline: legacyHeadline(summary.current, summary.previous),
    };
    res.set("Cache-Control", CACHE_CONTROL).json(response);
  } catch (err) {
    sendError(res, "/global", err);
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
