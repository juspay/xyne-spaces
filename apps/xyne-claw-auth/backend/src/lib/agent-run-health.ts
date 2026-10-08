import { prisma } from "../db.js";

const ORPHANED = "interrupted (orphaned run)";
const STUCK_FLOOR_MS = 30 * 60 * 1000;
const STUCK_P90_FACTOR = 3;

export interface AgentRunHealth {
  windowDays: number;
  totals: { runs: number; completed: number; failed: number; cancelled: number; running: number };
  duration: { p50Ms: number | null; p90Ms: number | null; llmP50Ms: number | null; toolP50Ms: number | null };
  daily: Array<{ day: string; runs: number; failed: number }>;
  byTrigger: Array<{ trigger: string; runs: number; failed: number; p50Ms: number | null; p90Ms: number | null }>;
  byModel: Array<{ provider: string; model: string; runs: number; failed: number; llmP50Ms: number | null }>;
  topErrors: Array<{ error: string; count: number; lastAt: string }>;
  stuckAfterMs: number;
  runningNow: Array<{ sessionId: string; trigger: string; startedAt: string; ageMs: number; stuck: boolean; currentTool: string | null }>;
  recentFailures: Array<{ sessionId: string; trigger: string; startedAt: string; model: string | null; error: string }>;
}

const num = (v: unknown): number => Number(v ?? 0);
const ms = (v: unknown): number | null => (v === null || v === undefined ? null : Math.round(Number(v)));

export async function agentRunHealth(agentSlug: string, orgId: string, windowDays: number): Promise<AgentRunHealth> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const [totals] = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT
      COUNT(*) AS runs,
      COUNT(*) FILTER (WHERE status = 'completed') AS completed,
      COUNT(*) FILTER (WHERE status = 'failed') AS failed,
      COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled,
      COUNT(*) FILTER (WHERE status = 'running') AS running,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM ("completedAt" - "startedAt")) * 1000)
        FILTER (WHERE status = 'completed' AND "completedAt" IS NOT NULL) AS p50,
      PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM ("completedAt" - "startedAt")) * 1000)
        FILTER (WHERE status = 'completed' AND "completedAt" IS NOT NULL) AS p90,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY "llmTotalMs") FILTER (WHERE "llmTotalMs" IS NOT NULL) AS llm_p50,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY "toolMs") FILTER (WHERE "toolMs" IS NOT NULL) AS tool_p50
    FROM "agent_runs"
    WHERE "agentSlug" = ${agentSlug} AND "orgId" = ${orgId} AND "startedAt" >= ${since}
      AND (error IS NULL OR error <> ${ORPHANED})
  `;

  const daily = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT to_char(date_trunc('day', "startedAt"), 'YYYY-MM-DD') AS day,
      COUNT(*) AS runs,
      COUNT(*) FILTER (WHERE status = 'failed') AS failed
    FROM "agent_runs"
    WHERE "agentSlug" = ${agentSlug} AND "orgId" = ${orgId} AND "startedAt" >= ${since}
      AND (error IS NULL OR error <> ${ORPHANED})
    GROUP BY 1 ORDER BY 1
  `;

  const byTrigger = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT COALESCE("triggerSource", 'unknown') AS trigger,
      COUNT(*) AS runs,
      COUNT(*) FILTER (WHERE status = 'failed') AS failed,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM ("completedAt" - "startedAt")) * 1000)
        FILTER (WHERE status = 'completed' AND "completedAt" IS NOT NULL) AS p50,
      PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM ("completedAt" - "startedAt")) * 1000)
        FILTER (WHERE status = 'completed' AND "completedAt" IS NOT NULL) AS p90
    FROM "agent_runs"
    WHERE "agentSlug" = ${agentSlug} AND "orgId" = ${orgId} AND "startedAt" >= ${since}
      AND (error IS NULL OR error <> ${ORPHANED})
    GROUP BY 1 ORDER BY runs DESC
  `;

  const byModel = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT COALESCE(provider, 'unknown') AS provider, COALESCE(model, 'unknown') AS model,
      COUNT(*) AS runs,
      COUNT(*) FILTER (WHERE status = 'failed') AS failed,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY "llmTotalMs") FILTER (WHERE "llmTotalMs" IS NOT NULL) AS llm_p50
    FROM "agent_runs"
    WHERE "agentSlug" = ${agentSlug} AND "orgId" = ${orgId} AND "startedAt" >= ${since}
      AND (error IS NULL OR error <> ${ORPHANED})
    GROUP BY 1, 2 ORDER BY runs DESC LIMIT 12
  `;

  const topErrors = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT LEFT(regexp_replace(error, '[0-9a-f]{8}-[0-9a-f-]{27,}|[0-9]{3,}', '#', 'g'), 140) AS error,
      COUNT(*) AS count,
      MAX("startedAt") AS last_at
    FROM "agent_runs"
    WHERE "agentSlug" = ${agentSlug} AND "orgId" = ${orgId} AND "startedAt" >= ${since}
      AND status = 'failed' AND error IS NOT NULL AND error <> ${ORPHANED}
    GROUP BY 1 ORDER BY count DESC LIMIT 8
  `;

  const p90 = ms(totals?.["p90"]);
  const stuckAfterMs = Math.max(STUCK_FLOOR_MS, (p90 ?? 0) * STUCK_P90_FACTOR);

  const running = await prisma.agentRun.findMany({
    where: { agentSlug, orgId, status: "running" },
    orderBy: { startedAt: "asc" },
    take: 25,
    select: { sessionId: true, triggerSource: true, startedAt: true, currentToolLabel: true },
  });

  const failures = await prisma.agentRun.findMany({
    where: { agentSlug, orgId, status: "failed", startedAt: { gte: since }, NOT: { error: ORPHANED } },
    orderBy: { startedAt: "desc" },
    take: 15,
    select: { sessionId: true, triggerSource: true, startedAt: true, model: true, error: true },
  });

  const now = Date.now();
  return {
    windowDays,
    totals: {
      runs: num(totals?.["runs"]),
      completed: num(totals?.["completed"]),
      failed: num(totals?.["failed"]),
      cancelled: num(totals?.["cancelled"]),
      running: num(totals?.["running"]),
    },
    duration: {
      p50Ms: ms(totals?.["p50"]),
      p90Ms: p90,
      llmP50Ms: ms(totals?.["llm_p50"]),
      toolP50Ms: ms(totals?.["tool_p50"]),
    },
    daily: daily.map((d) => ({ day: String(d["day"]), runs: num(d["runs"]), failed: num(d["failed"]) })),
    byTrigger: byTrigger.map((t) => ({
      trigger: String(t["trigger"]),
      runs: num(t["runs"]),
      failed: num(t["failed"]),
      p50Ms: ms(t["p50"]),
      p90Ms: ms(t["p90"]),
    })),
    byModel: byModel.map((m) => ({
      provider: String(m["provider"]),
      model: String(m["model"]),
      runs: num(m["runs"]),
      failed: num(m["failed"]),
      llmP50Ms: ms(m["llm_p50"]),
    })),
    topErrors: topErrors.map((e) => ({
      error: String(e["error"]),
      count: num(e["count"]),
      lastAt: new Date(e["last_at"] as string | Date).toISOString(),
    })),
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
    recentFailures: failures.map((f) => ({
      sessionId: f.sessionId,
      trigger: f.triggerSource ?? "unknown",
      startedAt: f.startedAt.toISOString(),
      model: f.model ?? null,
      error: (f.error ?? "").slice(0, 300),
    })),
  };
}
