import { prisma } from "../db.js";
import { redisService } from "../redis.js";

const ORPHANED = "interrupted (orphaned run)";
const OWNER_KEY_PREFIX = "claw:run-owner:";
const LIVE_IDLE_MS = 5 * 60 * 1000;
const LOST_IDLE_MS = 60 * 60 * 1000;
const MAX_WINDOW_ROWS = 20000;
const MAX_RUNNING_ROWS = 500;
const RECENT_RUNS = 40;

export const LOST_RUN_ERROR = "lost: no claw pod held the run and it never reported back";

export type RunSource = "automation" | "scheduled" | "people" | "workflow" | "delegated" | "awakening";
export type InflightState = "live" | "stuck" | "lost";

export interface SourceStats {
  id: RunSource | "all";
  runs: number;
  completed: number;
  failed: number;
  cancelled: number;
  lost: number;
  p50Ms: number | null;
  p90Ms: number | null;
}

export interface InflightRun {
  sessionId: string;
  state: InflightState;
  source: RunSource;
  task: string;
  startedAt: string;
  ageMs: number;
  idleMs: number;
  owned: boolean;
  currentStep: string | null;
}

type SourceCounts = Partial<Record<RunSource, { completed: number; failed: number; lost: number }>>;

export interface AgentRunHealth {
  windowDays: number;
  sampled: boolean;
  sources: SourceStats[];
  inflight: InflightRun[];
  daily: Array<{ day: string; bySource: SourceCounts }>;
  reasons: Array<{ error: string; count: number; lastAt: string; bySource: Partial<Record<RunSource, number>> }>;
  models: Array<{
    provider: string;
    model: string;
    runs: number;
    failed: number;
    llmP50Ms: number | null;
    bySource: Partial<Record<RunSource, { runs: number; failed: number }>>;
  }>;
  recentRuns: Array<{
    sessionId: string;
    source: RunSource;
    status: string;
    startedBy: string | null;
    startedAt: string;
    durationMs: number | null;
    model: string | null;
    task: string;
  }>;
  thresholds: { liveIdleMs: number; lostIdleMs: number };
}

export interface AgentRunDetail {
  run: Record<string, unknown>;
  source: RunSource;
  inflight: { state: InflightState; idleMs: number; owned: boolean } | null;
  requester: { id: string; name: string | null; email: string | null } | null;
  children: Array<{ sessionId: string; agentSlug: string; status: string; startedAt: string; durationMs: number | null; task: string }>;
}

export function runSource(run: { sessionId: string; parentSessionId: string | null; triggerSource: string | null }): RunSource {
  if (run.sessionId.startsWith("wf-")) return "workflow";
  if (run.parentSessionId) return "delegated";
  switch (run.triggerSource) {
    case "automation":
      return "automation";
    case "scheduled":
      return "scheduled";
    case "reflex":
    case "heartbeat":
    case "awakening":
      return "awakening";
    default:
      return "people";
  }
}

function percentile(values: number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return Math.round(sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo));
}

function normalizeError(error: string | null): string {
  return (error ?? "").replace(/[0-9a-f]{8}-[0-9a-f-]{27,}|[0-9]{3,}/gi, "#").replace(/\s+/g, " ").trim().slice(0, 160);
}

function lastActivityAt(startedAt: Date, toolInvocations: unknown): number {
  let last = startedAt.getTime();
  if (!Array.isArray(toolInvocations)) return last;
  for (const inv of toolInvocations) {
    if (!inv || typeof inv !== "object") continue;
    const rec = inv as Record<string, unknown>;
    const started = typeof rec["startedAt"] === "string" ? Date.parse(rec["startedAt"]) : NaN;
    if (Number.isNaN(started)) continue;
    const duration = typeof rec["durationMs"] === "number" ? rec["durationMs"] : 0;
    last = Math.max(last, started + duration);
  }
  return last;
}

export function classifyInflight(idleMs: number, owned: boolean): InflightState {
  if (idleMs < LIVE_IDLE_MS) return "live";
  if (owned) return "stuck";
  return idleMs < LOST_IDLE_MS ? "stuck" : "lost";
}

async function ownedSessions(sessionIds: string[]): Promise<Set<string>> {
  if (sessionIds.length === 0) return new Set();
  try {
    const redis = redisService.getConnection();
    const values = await redis.mget(...sessionIds.map((id) => `${OWNER_KEY_PREFIX}${id}`));
    return new Set(sessionIds.filter((_, i) => values[i] !== null));
  } catch {
    return new Set(sessionIds);
  }
}

export async function loadInflight(agentSlug: string, orgId: string, sessionIds?: string[]): Promise<InflightRun[]> {
  const rows = await prisma.agentRun.findMany({
    where: { agentSlug, orgId, status: "running", ...(sessionIds ? { sessionId: { in: sessionIds } } : {}) },
    orderBy: { startedAt: "asc" },
    take: MAX_RUNNING_ROWS,
    select: {
      sessionId: true,
      parentSessionId: true,
      triggerSource: true,
      startedAt: true,
      currentToolLabel: true,
      task: true,
      toolInvocations: true,
    },
  });
  const owned = await ownedSessions(rows.map((r) => r.sessionId));
  const now = Date.now();
  return rows.map((r) => {
    const idleMs = now - lastActivityAt(r.startedAt, r.toolInvocations);
    const isOwned = owned.has(r.sessionId);
    return {
      sessionId: r.sessionId,
      state: classifyInflight(idleMs, isOwned),
      source: runSource(r),
      task: r.task.replace(/\s+/g, " ").slice(0, 200),
      startedAt: r.startedAt.toISOString(),
      ageMs: now - r.startedAt.getTime(),
      idleMs,
      owned: isOwned,
      currentStep: r.currentToolLabel ?? null,
    };
  });
}

export async function agentRunHealth(agentSlug: string, orgId: string, windowDays: number): Promise<AgentRunHealth> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const inWindow = { agentSlug, orgId, startedAt: { gte: since } };

  const [rows, inflight, recent] = await Promise.all([
    prisma.agentRun.findMany({
      where: { ...inWindow, status: { not: "running" }, OR: [{ error: null }, { error: { not: ORPHANED } }] },
      orderBy: { startedAt: "desc" },
      take: MAX_WINDOW_ROWS,
      select: {
        sessionId: true,
        parentSessionId: true,
        triggerSource: true,
        status: true,
        provider: true,
        model: true,
        startedAt: true,
        completedAt: true,
        llmTotalMs: true,
        error: true,
      },
    }),
    loadInflight(agentSlug, orgId),
    prisma.agentRun.findMany({
      where: { ...inWindow, status: { not: "running" } },
      orderBy: { startedAt: "desc" },
      take: RECENT_RUNS,
      select: {
        sessionId: true,
        parentSessionId: true,
        triggerSource: true,
        status: true,
        startedAt: true,
        completedAt: true,
        model: true,
        task: true,
        userId: true,
      },
    }),
  ]);

  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(recent.map((r) => r.userId))] } },
    select: { id: true, name: true, email: true },
  });
  const userName = new Map(users.map((u) => [u.id, u.name || u.email || null]));

  const sourceIds: Array<RunSource | "all"> = ["all", "automation", "scheduled", "people", "workflow", "delegated", "awakening"];
  const acc = new Map(sourceIds.map((id) => [id, { completed: 0, failed: 0, cancelled: 0, runs: 0, lost: 0, durations: [] as number[] }]));
  const daily = new Map<string, SourceCounts>();
  const reasons = new Map<string, { count: number; lastAt: Date; bySource: Partial<Record<RunSource, number>> }>();
  const models = new Map<string, { provider: string; model: string; runs: number; failed: number; llm: number[]; bySource: Partial<Record<RunSource, { runs: number; failed: number }>> }>();

  const dayBucket = (day: string, source: RunSource) => {
    const d = daily.get(day) ?? {};
    const b = d[source] ?? { completed: 0, failed: 0, lost: 0 };
    d[source] = b;
    daily.set(day, d);
    return b;
  };

  for (const r of rows) {
    const source = runSource(r);
    const duration = r.status === "completed" && r.completedAt ? r.completedAt.getTime() - r.startedAt.getTime() : null;
    for (const key of ["all", source] as const) {
      const a = acc.get(key)!;
      a.runs += 1;
      if (r.status === "completed") a.completed += 1;
      else if (r.status === "failed") a.failed += 1;
      else if (r.status === "cancelled") a.cancelled += 1;
      if (duration !== null) a.durations.push(duration);
    }

    const bucket = dayBucket(r.startedAt.toISOString().slice(0, 10), source);
    if (r.status === "completed") bucket.completed += 1;
    else if (r.status === "failed") bucket.failed += 1;

    if (r.status === "failed") {
      const key = normalizeError(r.error) || "(no error recorded)";
      const e = reasons.get(key) ?? { count: 0, lastAt: r.startedAt, bySource: {} };
      e.count += 1;
      if (r.startedAt > e.lastAt) e.lastAt = r.startedAt;
      e.bySource[source] = (e.bySource[source] ?? 0) + 1;
      reasons.set(key, e);
    }

    const provider = r.provider ?? "unknown";
    const model = r.model ?? "unknown";
    const mk = `${provider}|${model}`;
    const m = models.get(mk) ?? { provider, model, runs: 0, failed: 0, llm: [], bySource: {} };
    m.runs += 1;
    if (r.status === "failed") m.failed += 1;
    if (r.llmTotalMs !== null) m.llm.push(r.llmTotalMs);
    const ms = m.bySource[source] ?? { runs: 0, failed: 0 };
    ms.runs += 1;
    if (r.status === "failed") ms.failed += 1;
    m.bySource[source] = ms;
    models.set(mk, m);
  }

  for (const run of inflight) {
    if (run.state !== "lost") continue;
    acc.get("all")!.lost += 1;
    acc.get(run.source)!.lost += 1;
    const day = run.startedAt.slice(0, 10);
    if (new Date(run.startedAt) >= since) dayBucket(day, run.source).lost += 1;
  }

  return {
    windowDays,
    sampled: rows.length >= MAX_WINDOW_ROWS,
    sources: sourceIds.map((id) => {
      const a = acc.get(id)!;
      return {
        id,
        runs: a.runs,
        completed: a.completed,
        failed: a.failed,
        cancelled: a.cancelled,
        lost: a.lost,
        p50Ms: percentile(a.durations, 0.5),
        p90Ms: percentile(a.durations, 0.9),
      };
    }),
    inflight: inflight.sort((a, b) => b.ageMs - a.ageMs),
    daily: [...daily.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, bySource]) => ({ day, bySource })),
    reasons: [...reasons.entries()]
      .map(([error, v]) => ({ error, count: v.count, lastAt: v.lastAt.toISOString(), bySource: v.bySource }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12),
    models: [...models.values()]
      .map((v) => ({ provider: v.provider, model: v.model, runs: v.runs, failed: v.failed, llmP50Ms: percentile(v.llm, 0.5), bySource: v.bySource }))
      .sort((a, b) => b.runs - a.runs)
      .slice(0, 12),
    recentRuns: recent.map((r) => ({
      sessionId: r.sessionId,
      source: runSource(r),
      status: r.status,
      startedBy: userName.get(r.userId) ?? null,
      startedAt: r.startedAt.toISOString(),
      durationMs: r.completedAt ? r.completedAt.getTime() - r.startedAt.getTime() : null,
      model: r.model ?? null,
      task: r.task.replace(/\s+/g, " ").slice(0, 200),
    })),
    thresholds: { liveIdleMs: LIVE_IDLE_MS, lostIdleMs: LOST_IDLE_MS },
  };
}

export async function agentRunDetail(agentSlug: string, orgId: string, sessionId: string): Promise<AgentRunDetail | null> {
  const run = await prisma.agentRun.findUnique({ where: { sessionId } });
  if (!run || run.agentSlug !== agentSlug || run.orgId !== orgId) return null;
  const [requester, children, inflight] = await Promise.all([
    prisma.user.findUnique({ where: { id: run.userId }, select: { id: true, name: true, email: true } }),
    prisma.agentRun.findMany({
      where: { parentSessionId: sessionId },
      orderBy: { startedAt: "asc" },
      take: 50,
      select: { sessionId: true, agentSlug: true, status: true, startedAt: true, completedAt: true, task: true },
    }),
    run.status === "running" ? loadInflight(agentSlug, orgId, [sessionId]) : Promise.resolve([]),
  ]);
  const live = inflight[0];
  return {
    run: run as unknown as Record<string, unknown>,
    source: runSource(run),
    inflight: live ? { state: live.state, idleMs: live.idleMs, owned: live.owned } : null,
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

export async function closeLostRuns(agentSlug: string, orgId: string, sessionIds?: string[]): Promise<{ closed: string[]; skipped: string[] }> {
  const inflight = await loadInflight(agentSlug, orgId, sessionIds);
  const lost = inflight.filter((r) => r.state === "lost").map((r) => r.sessionId);
  const skipped = (sessionIds ?? []).filter((id) => !lost.includes(id));
  if (lost.length === 0) return { closed: [], skipped };
  const now = new Date();
  await prisma.agentRun.updateMany({
    where: { agentSlug, orgId, status: "running", sessionId: { in: lost } },
    data: { status: "failed", error: LOST_RUN_ERROR, completedAt: now, currentToolLabel: null },
  });
  return { closed: lost, skipped };
}
