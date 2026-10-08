import { prisma } from "../db.js";

const ORPHANED = "interrupted (orphaned run)";
const STUCK_FLOOR_MS = 30 * 60 * 1000;
const STUCK_P90_FACTOR = 3;

export interface AgentRunHealth {
  windowDays: number;
  sampled: boolean;
  totals: { runs: number; completed: number; failed: number; cancelled: number; running: number };
  duration: { p50Ms: number | null; p90Ms: number | null; llmP50Ms: number | null; toolP50Ms: number | null };
  daily: Array<{ day: string; runs: number; failed: number }>;
  byTrigger: Array<{ trigger: string; runs: number; failed: number; p50Ms: number | null; p90Ms: number | null }>;
  byModel: Array<{ provider: string; model: string; runs: number; failed: number; llmP50Ms: number | null }>;
  topErrors: Array<{ error: string; count: number; lastAt: string }>;
  stuckAfterMs: number;
  runningNow: Array<{ sessionId: string; trigger: string; startedAt: string; ageMs: number; stuck: boolean; currentTool: string | null }>;
  recentFailures: Array<{ sessionId: string; trigger: string; startedAt: string; model: string | null; error: string }>;
  recentRuns: Array<{ sessionId: string; trigger: string; status: string; startedAt: string; durationMs: number | null; model: string | null; task: string }>;
}

export interface AgentRunDetail {
  run: Record<string, unknown>;
  requester: { id: string; name: string | null; email: string | null } | null;
  children: Array<{ sessionId: string; agentSlug: string; status: string; startedAt: string; durationMs: number | null; task: string }>;
}

const MAX_WINDOW_ROWS = 20000;
const MAX_FAILED_ROWS = 2000;

function percentile(values: number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return Math.round(sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo));
}

function normalizeError(error: string): string {
  return error.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}|[0-9]{3,}/gi, "#").slice(0, 140);
}

function bump<K>(map: Map<K, number>, key: K): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

export async function agentRunHealth(agentSlug: string, orgId: string, windowDays: number): Promise<AgentRunHealth> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const inWindow = { agentSlug, orgId, startedAt: { gte: since } };

  const [rows, failedRows, running, recent] = await Promise.all([
    prisma.agentRun.findMany({
      where: { ...inWindow, OR: [{ error: null }, { error: { not: ORPHANED } }] },
      orderBy: { startedAt: "desc" },
      take: MAX_WINDOW_ROWS,
      select: {
        status: true,
        triggerSource: true,
        provider: true,
        model: true,
        startedAt: true,
        completedAt: true,
        llmTotalMs: true,
        toolMs: true,
      },
    }),
    prisma.agentRun.findMany({
      where: { ...inWindow, status: "failed", NOT: [{ error: null }, { error: ORPHANED }] },
      orderBy: { startedAt: "desc" },
      take: MAX_FAILED_ROWS,
      select: { sessionId: true, triggerSource: true, startedAt: true, model: true, error: true },
    }),
    prisma.agentRun.findMany({
      where: { agentSlug, orgId, status: "running" },
      orderBy: { startedAt: "asc" },
      take: 25,
      select: { sessionId: true, triggerSource: true, startedAt: true, currentToolLabel: true },
    }),
    prisma.agentRun.findMany({
      where: inWindow,
      orderBy: { startedAt: "desc" },
      take: 30,
      select: { sessionId: true, triggerSource: true, status: true, startedAt: true, completedAt: true, model: true, task: true },
    }),
  ]);

  const statusCount = new Map<string, number>();
  const completedDurations: number[] = [];
  const llm: number[] = [];
  const tool: number[] = [];
  const daily = new Map<string, { runs: number; failed: number }>();
  const triggers = new Map<string, { runs: number; failed: number; durations: number[] }>();
  const models = new Map<string, { provider: string; model: string; runs: number; failed: number; llm: number[] }>();

  for (const r of rows) {
    bump(statusCount, r.status);
    const failed = r.status === "failed";
    const duration = r.status === "completed" && r.completedAt ? r.completedAt.getTime() - r.startedAt.getTime() : null;
    if (duration !== null) completedDurations.push(duration);
    if (r.llmTotalMs !== null) llm.push(r.llmTotalMs);
    if (r.toolMs !== null) tool.push(r.toolMs);

    const day = r.startedAt.toISOString().slice(0, 10);
    const d = daily.get(day) ?? { runs: 0, failed: 0 };
    d.runs += 1;
    if (failed) d.failed += 1;
    daily.set(day, d);

    const trigger = r.triggerSource ?? "unknown";
    const t = triggers.get(trigger) ?? { runs: 0, failed: 0, durations: [] };
    t.runs += 1;
    if (failed) t.failed += 1;
    if (duration !== null) t.durations.push(duration);
    triggers.set(trigger, t);

    const provider = r.provider ?? "unknown";
    const model = r.model ?? "unknown";
    const key = `${provider}|${model}`;
    const m = models.get(key) ?? { provider, model, runs: 0, failed: 0, llm: [] };
    m.runs += 1;
    if (failed) m.failed += 1;
    if (r.llmTotalMs !== null) m.llm.push(r.llmTotalMs);
    models.set(key, m);
  }

  const errors = new Map<string, { count: number; lastAt: Date }>();
  for (const f of failedRows) {
    const key = normalizeError(f.error ?? "");
    const e = errors.get(key);
    if (e) {
      e.count += 1;
      if (f.startedAt > e.lastAt) e.lastAt = f.startedAt;
    } else {
      errors.set(key, { count: 1, lastAt: f.startedAt });
    }
  }

  const p90 = percentile(completedDurations, 0.9);
  const stuckAfterMs = Math.max(STUCK_FLOOR_MS, (p90 ?? 0) * STUCK_P90_FACTOR);
  const now = Date.now();

  return {
    windowDays,
    sampled: rows.length >= MAX_WINDOW_ROWS,
    totals: {
      runs: rows.length,
      completed: statusCount.get("completed") ?? 0,
      failed: statusCount.get("failed") ?? 0,
      cancelled: statusCount.get("cancelled") ?? 0,
      running: statusCount.get("running") ?? 0,
    },
    duration: {
      p50Ms: percentile(completedDurations, 0.5),
      p90Ms: p90,
      llmP50Ms: percentile(llm, 0.5),
      toolP50Ms: percentile(tool, 0.5),
    },
    daily: [...daily.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, v]) => ({ day, ...v })),
    byTrigger: [...triggers.entries()]
      .map(([trigger, v]) => ({
        trigger,
        runs: v.runs,
        failed: v.failed,
        p50Ms: percentile(v.durations, 0.5),
        p90Ms: percentile(v.durations, 0.9),
      }))
      .sort((a, b) => b.runs - a.runs),
    byModel: [...models.values()]
      .map((v) => ({ provider: v.provider, model: v.model, runs: v.runs, failed: v.failed, llmP50Ms: percentile(v.llm, 0.5) }))
      .sort((a, b) => b.runs - a.runs)
      .slice(0, 12),
    topErrors: [...errors.entries()]
      .map(([error, v]) => ({ error, count: v.count, lastAt: v.lastAt.toISOString() }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8),
    stuckAfterMs,
    runningNow: running.map((r) => {
      const ageMs = now - r.startedAt.getTime();
      return {
        sessionId: r.sessionId,
        trigger: r.triggerSource ?? "unknown",
        startedAt: r.startedAt.toISOString(),
        ageMs,
        stuck: ageMs > stuckAfterMs,
        currentTool: r.currentToolLabel ?? null,
      };
    }),
    recentFailures: failedRows.slice(0, 15).map((f) => ({
      sessionId: f.sessionId,
      trigger: f.triggerSource ?? "unknown",
      startedAt: f.startedAt.toISOString(),
      model: f.model ?? null,
      error: (f.error ?? "").slice(0, 300),
    })),
    recentRuns: recent.map((r) => ({
      sessionId: r.sessionId,
      trigger: r.triggerSource ?? "unknown",
      status: r.status,
      startedAt: r.startedAt.toISOString(),
      durationMs: r.completedAt ? r.completedAt.getTime() - r.startedAt.getTime() : null,
      model: r.model ?? null,
      task: r.task.slice(0, 200),
    })),
  };
}

export async function agentRunDetail(agentSlug: string, orgId: string, sessionId: string): Promise<AgentRunDetail | null> {
  const run = await prisma.agentRun.findUnique({ where: { sessionId } });
  if (!run || run.agentSlug !== agentSlug || run.orgId !== orgId) return null;
  const [requester, children] = await Promise.all([
    prisma.user.findUnique({ where: { id: run.userId }, select: { id: true, name: true, email: true } }),
    prisma.agentRun.findMany({
      where: { parentSessionId: sessionId },
      orderBy: { startedAt: "asc" },
      take: 50,
      select: { sessionId: true, agentSlug: true, status: true, startedAt: true, completedAt: true, task: true },
    }),
  ]);
  return {
    run: run as unknown as Record<string, unknown>,
    requester,
    children: children.map((c) => ({
      sessionId: c.sessionId,
      agentSlug: c.agentSlug,
      status: c.status,
      startedAt: c.startedAt.toISOString(),
      durationMs: c.completedAt ? c.completedAt.getTime() - c.startedAt.getTime() : null,
      task: c.task.slice(0, 200),
    })),
  };
}
