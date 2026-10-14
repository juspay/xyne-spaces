import { prisma } from "../../db.js";
import { isClawAdmin } from "../../middleware/agent-acl.js";
import { createLogger } from "../../logger.js";

const log = createLogger("fleet-stats");

const ORPHANED = "interrupted (orphaned run)";
const MIN_RUNS_FOR_SLOWEST = 3;

export interface FleetRunRow {
  sessionId: string;
  agentSlug: string;
  status: string;
  provider: string | null;
  model: string | null;
  triggerSource: string;
  durationMs: number | null;
  llmTotalMs: number | null;
  llmWaitMs: number | null;
  llmDecodeMs: number | null;
  toolMs: number | null;
  ttftMs: number | null;
  tokensPerSec: number | null;
  llmTurns: number | null;
  llmRetries: number | null;
  lastRetryReason: string | null;
  error: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  rating: string | null;
  startedAt: Date;
}

export interface FleetBaselineRow {
  agentSlug: string;
  runs: number;
  failed: number;
  p50Ms: number | null;
  p95Ms: number | null;
}

export interface FleetToolRow {
  tool: string;
  calls: number;
  errors: number;
  p50Ms: number | null;
  p95Ms: number | null;
  agents: string[];
}

export interface FleetStatsInput {
  from: Date;
  to: Date;
  baselineDays: number;
  runs: FleetRunRow[];
  baseline: FleetBaselineRow[];
  tools: FleetToolRow[];
  topErrors: number;
  topTools: number;
  maxAgents: number;
}

function percentile(values: number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * fraction;
  const lower = sorted[Math.floor(position)]!;
  const upper = sorted[Math.ceil(position)]!;
  return lower + (upper - lower) * (position - Math.floor(position));
}

const pct = (count: number, total: number): number => (total > 0 ? Math.round((count / total) * 1000) / 10 : 0);
const sec = (ms: number | null): number | null => (ms === null ? null : Math.round(ms / 100) / 10);
const round = (n: number | null): number | null => (n === null ? null : Math.round(n));
const nums = (values: Array<number | null>): number[] => values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
const sum = (values: Array<number | null>): number => nums(values).reduce((a, b) => a + b, 0);

function changePct(current: number | null, base: number | null): number | null {
  if (current === null || base === null || base <= 0) return null;
  return Math.round(((current - base) / base) * 1000) / 10;
}

export function normalizeError(raw: string): string {
  return raw
    .split("\n")[0]!
    .replace(/https?:\/\/\S+/g, "<url>")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<id>")
    .replace(/\bc[a-z0-9]{20,}\b/g, "<id>")
    .replace(/\b[0-9a-f]{16,}\b/gi, "<hex>")
    .replace(/\d+(\.\d+)?/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

function timeBreakdown(rows: FleetRunRow[]): Record<string, number | null> {
  const total = sum(rows.map((r) => r.durationMs));
  if (total <= 0) return { llmWaitPct: null, llmDecodePct: null, llmOtherPct: null, toolPct: null, otherPct: null };
  const wait = sum(rows.map((r) => r.llmWaitMs));
  const decode = sum(rows.map((r) => r.llmDecodeMs));
  const llm = sum(rows.map((r) => r.llmTotalMs));
  const tool = sum(rows.map((r) => r.toolMs));
  const llmOther = Math.max(0, llm - wait - decode);
  return {
    llmWaitPct: pct(wait, total),
    llmDecodePct: pct(decode, total),
    llmOtherPct: pct(llmOther, total),
    toolPct: pct(tool, total),
    otherPct: pct(Math.max(0, total - llm - tool), total),
  };
}

function topCounts(values: Array<string | null>, limit: number): Array<{ value: string; count: number }> {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([value, count]) => ({ value, count }));
}

function dominantCause(breakdown: Record<string, number | null>, retries: number, runs: number): string {
  const parts: Array<[string, number]> = [
    ["waiting on the LLM provider (queue / time to first token)", breakdown["llmWaitPct"] ?? 0],
    ["LLM generation (long outputs)", breakdown["llmDecodePct"] ?? 0],
    ["tool calls", breakdown["toolPct"] ?? 0],
    ["other LLM time (many turns / large context)", breakdown["llmOtherPct"] ?? 0],
    ["non-LLM, non-tool time (sandbox, queueing, compaction)", breakdown["otherPct"] ?? 0],
  ];
  const [label, share] = parts.sort((a, b) => b[1] - a[1])[0]!;
  const retryNote = runs > 0 && retries / runs >= 0.5 ? `; ${retries} LLM retries across ${runs} runs` : "";
  return share > 0 ? `${label} — ${share}% of run time${retryNote}` : `no timing breakdown recorded${retryNote}`;
}

export function buildFleetStats(input: FleetStatsInput): Record<string, unknown> {
  const live = input.runs.filter((r) => r.error !== ORPHANED);
  const orphaned = input.runs.length - live.length;
  const completedDurations = (rows: FleetRunRow[]) => nums(rows.filter((r) => r.status === "completed").map((r) => r.durationMs));
  const count = (rows: FleetRunRow[], status: string) => rows.filter((r) => r.status === status).length;
  const baselineBySlug = new Map(input.baseline.map((b) => [b.agentSlug, b]));
  const windowHours = (input.to.getTime() - input.from.getTime()) / 3_600_000;

  const bySlug = new Map<string, FleetRunRow[]>();
  for (const r of live) bySlug.set(r.agentSlug, [...(bySlug.get(r.agentSlug) ?? []), r]);

  const agents = [...bySlug].map(([agentSlug, rows]) => {
    const durations = completedDurations(rows);
    const failed = count(rows, "failed");
    const cancelled = count(rows, "cancelled");
    const p50 = percentile(durations, 0.5);
    const p95 = percentile(durations, 0.95);
    const base = baselineBySlug.get(agentSlug);
    const retries = sum(rows.map((r) => r.llmRetries));
    return {
      agentSlug,
      runs: rows.length,
      completed: count(rows, "completed"),
      failed,
      cancelled,
      failedPct: pct(failed, rows.length),
      p50S: sec(p50),
      p95S: sec(p95),
      p50LlmWaitMs: round(percentile(nums(rows.map((r) => r.llmWaitMs)), 0.5)),
      p50TtftMs: round(percentile(nums(rows.map((r) => r.ttftMs)), 0.5)),
      p50ToolMs: round(percentile(nums(rows.map((r) => r.toolMs)), 0.5)),
      avgLlmTurns: rows.length ? Math.round((sum(rows.map((r) => r.llmTurns)) / rows.length) * 10) / 10 : null,
      llmRetries: retries,
      tokensIn: sum(rows.map((r) => r.tokensIn)),
      tokensOut: sum(rows.map((r) => r.tokensOut)),
      ratingsUp: rows.filter((r) => r.rating === "up").length,
      ratingsDown: rows.filter((r) => r.rating === "down").length,
      providers: topCounts(rows.map((r) => r.provider), 3),
      baseline: base
        ? {
            runsPerWindow: Math.round((base.runs / (input.baselineDays * 24)) * windowHours * 10) / 10,
            failedPct: pct(base.failed, base.runs),
            p50S: sec(base.p50Ms),
            p95S: sec(base.p95Ms),
          }
        : null,
      p95ChangePct: changePct(p95, base?.p95Ms ?? null),
      failedPctChange: base ? Math.round((pct(failed, rows.length) - pct(base.failed, base.runs)) * 10) / 10 : null,
      timeBreakdown: timeBreakdown(rows.filter((r) => r.status === "completed")),
      topRetryReasons: topCounts(rows.map((r) => r.lastRetryReason?.slice(0, 160) ?? null), 3),
    };
  });
  agents.sort((a, b) => b.failed - a.failed || b.runs - a.runs);

  const slowest = agents
    .filter((a) => a.completed >= MIN_RUNS_FOR_SLOWEST && a.p95S !== null)
    .sort((a, b) => (b.p95S ?? 0) - (a.p95S ?? 0))
    .slice(0, 10)
    .map((a) => ({
      agentSlug: a.agentSlug,
      p50S: a.p50S,
      p95S: a.p95S,
      p95ChangePct: a.p95ChangePct,
      timeBreakdown: a.timeBreakdown,
      likelyCause: dominantCause(a.timeBreakdown, a.llmRetries, a.runs),
      topRetryReasons: a.topRetryReasons,
    }));

  const errorGroups = new Map<string, { count: number; agents: Set<string>; firstSeen: Date; lastSeen: Date; sessions: string[] }>();
  for (const r of live) {
    if (r.status !== "failed" || !r.error) continue;
    const key = normalizeError(r.error);
    const g = errorGroups.get(key) ?? { count: 0, agents: new Set<string>(), firstSeen: r.startedAt, lastSeen: r.startedAt, sessions: [] };
    g.count += 1;
    g.agents.add(r.agentSlug);
    if (r.startedAt < g.firstSeen) g.firstSeen = r.startedAt;
    if (r.startedAt > g.lastSeen) g.lastSeen = r.startedAt;
    if (g.sessions.length < 2) g.sessions.push(r.sessionId);
    errorGroups.set(key, g);
  }
  const errors = [...errorGroups]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, input.topErrors)
    .map(([message, g]) => ({
      message,
      count: g.count,
      agents: [...g.agents].slice(0, 10),
      firstSeen: g.firstSeen.toISOString(),
      lastSeen: g.lastSeen.toISOString(),
      exampleSessions: g.sessions,
    }));

  const byProvider = new Map<string, FleetRunRow[]>();
  for (const r of live) {
    const key = `${r.provider ?? "unknown"}|${r.model ?? "unknown"}`;
    byProvider.set(key, [...(byProvider.get(key) ?? []), r]);
  }
  const providers = [...byProvider]
    .map(([key, rows]) => {
      const [provider, model] = key.split("|");
      const failed = count(rows, "failed");
      return {
        provider,
        model,
        runs: rows.length,
        failed,
        failedPct: pct(failed, rows.length),
        llmRetries: sum(rows.map((r) => r.llmRetries)),
        p50TtftMs: round(percentile(nums(rows.map((r) => r.ttftMs)), 0.5)),
        p50TokensPerSec: round(percentile(nums(rows.map((r) => r.tokensPerSec)), 0.5)),
        topRetryReasons: topCounts(rows.map((r) => r.lastRetryReason?.slice(0, 160) ?? null), 3),
      };
    })
    .sort((a, b) => b.runs - a.runs);

  const allDurations = completedDurations(live);
  const overallFailed = count(live, "failed");
  return {
    window: { from: input.from.toISOString(), to: input.to.toISOString(), hours: Math.round(windowHours * 10) / 10 },
    baselineDays: input.baselineDays,
    overall: {
      runs: live.length,
      completed: count(live, "completed"),
      failed: overallFailed,
      cancelled: count(live, "cancelled"),
      running: count(live, "running"),
      orphanedExcluded: orphaned,
      failedPct: pct(overallFailed, live.length),
      p50S: sec(percentile(allDurations, 0.5)),
      p95S: sec(percentile(allDurations, 0.95)),
      activeAgents: bySlug.size,
      byTriggerSource: topCounts(live.map((r) => r.triggerSource), 10),
      timeBreakdown: timeBreakdown(live.filter((r) => r.status === "completed")),
    },
    agents: agents.slice(0, input.maxAgents),
    agentsTruncated: Math.max(0, agents.length - input.maxAgents),
    slowestAgents: slowest,
    errors,
    distinctErrors: errorGroups.size,
    tools: input.tools
      .slice()
      .sort((a, b) => b.calls - a.calls)
      .slice(0, input.topTools)
      .map((t) => ({ tool: t.tool, runsUsing: t.calls, agents: t.agents.slice(0, 5) })),
    providers,
    notes: [
      "Durations are completedAt - startedAt of completed runs (falls back to totalMs).",
      "Runs ended as 'interrupted (orphaned run)' are excluded and counted in overall.orphanedExcluded.",
      "timeBreakdown is each phase's share of total run time; llmOther = LLM time not attributed to wait/decode.",
      "tools[].runsUsing counts runs that used the tool (from toolsUsed); per-tool error rates and latency are not included.",
    ],
  };
}

function clampInt(raw: unknown, fallback: number, min: number, max: number): number {
  const n = Math.trunc(Number(raw));
  return Number.isFinite(n) && raw !== undefined && raw !== null && raw !== "" ? Math.min(Math.max(n, min), max) : fallback;
}

interface RunTiming {
  agentSlug: string;
  status: string;
  error: string | null;
  startedAt: Date;
  completedAt: Date | null;
}

function durationMs(r: { startedAt: Date; completedAt: Date | null; totalMs?: number | null }): number | null {
  if (r.completedAt) return r.completedAt.getTime() - r.startedAt.getTime();
  return r.totalMs ?? null;
}

export function summarizeBaseline(rows: RunTiming[]): FleetBaselineRow[] {
  const bySlug = new Map<string, { runs: number; failed: number; durations: number[] }>();
  for (const r of rows) {
    if (r.error === ORPHANED) continue;
    const b = bySlug.get(r.agentSlug) ?? { runs: 0, failed: 0, durations: [] };
    b.runs += 1;
    if (r.status === "failed") b.failed += 1;
    if (r.status === "completed" && r.completedAt) b.durations.push(r.completedAt.getTime() - r.startedAt.getTime());
    bySlug.set(r.agentSlug, b);
  }
  return [...bySlug].map(([agentSlug, b]) => ({
    agentSlug,
    runs: b.runs,
    failed: b.failed,
    p50Ms: percentile(b.durations, 0.5),
    p95Ms: percentile(b.durations, 0.95),
  }));
}

export function summarizeToolUsage(rows: Array<{ agentSlug: string; toolsUsed: string[] | null }>): FleetToolRow[] {
  const byTool = new Map<string, { runs: number; agents: Set<string> }>();
  for (const r of rows) {
    for (const tool of new Set(r.toolsUsed ?? [])) {
      if (!tool) continue;
      const t = byTool.get(tool) ?? { runs: 0, agents: new Set<string>() };
      t.runs += 1;
      t.agents.add(r.agentSlug);
      byTool.set(tool, t);
    }
  }
  return [...byTool].map(([tool, t]) => ({ tool, calls: t.runs, errors: 0, p50Ms: null, p95Ms: null, agents: [...t.agents].slice(0, 20) }));
}

export async function handleGetFleetStats(
  params: Record<string, unknown>,
  contextOrgId?: string,
  requestingUserId?: string,
): Promise<string> {
  if (!contextOrgId) return JSON.stringify({ error: "contextOrgId is required" });
  if (!requestingUserId || !(await isClawAdmin(requestingUserId))) {
    log.warn(`[fleet-stats] refused non-admin requester=${requestingUserId ?? "none"} orgId=${contextOrgId}`);
    return JSON.stringify({ error: "get_fleet_stats is restricted to claw admins (CLAW_ADMIN role)." });
  }

  const hours = clampInt(params["hours"], 24, 1, 168);
  const baselineDays = clampInt(params["baselineDays"], 7, 1, 30);
  const topErrors = clampInt(params["topErrors"], 15, 1, 50);
  const topTools = clampInt(params["topTools"], 15, 1, 50);
  const maxAgents = clampInt(params["maxAgents"], 60, 1, 200);
  const agentSlugs = Array.isArray(params["agentSlugs"])
    ? (params["agentSlugs"] as unknown[]).filter((s): s is string => typeof s === "string" && s.trim() !== "").map((s) => s.trim())
    : [];

  const to = new Date();
  const from = new Date(to.getTime() - hours * 3_600_000);
  const baselineFrom = new Date(from.getTime() - baselineDays * 86_400_000);
  const scope = { orgId: contextOrgId, ...(agentSlugs.length > 0 ? { agentSlug: { in: agentSlugs } } : {}) };

  const [runRows, baselineRows] = await Promise.all([
    prisma.agentRun.findMany({
      where: { ...scope, startedAt: { gte: from } },
      select: {
        sessionId: true,
        agentSlug: true,
        status: true,
        provider: true,
        model: true,
        triggerSource: true,
        startedAt: true,
        completedAt: true,
        totalMs: true,
        llmTotalMs: true,
        llmWaitMs: true,
        llmDecodeMs: true,
        toolMs: true,
        ttftMs: true,
        tokensPerSec: true,
        llmTurns: true,
        llmRetries: true,
        lastRetryReason: true,
        error: true,
        tokensIn: true,
        tokensOut: true,
        rating: true,
        toolsUsed: true,
      },
    }),
    prisma.agentRun.findMany({
      where: { ...scope, startedAt: { gte: baselineFrom, lt: from } },
      select: { agentSlug: true, status: true, error: true, startedAt: true, completedAt: true },
    }),
  ]);

  const stats = buildFleetStats({
    from,
    to,
    baselineDays,
    topErrors,
    topTools,
    maxAgents,
    runs: runRows.map(({ toolsUsed: _toolsUsed, ...r }) => ({
      ...r,
      durationMs: durationMs(r),
      lastRetryReason: r.lastRetryReason?.slice(0, 300) ?? null,
      error: r.error?.slice(0, 500) ?? null,
    })),
    baseline: summarizeBaseline(baselineRows),
    tools: summarizeToolUsage(runRows),
  });
  return JSON.stringify(stats);
}
