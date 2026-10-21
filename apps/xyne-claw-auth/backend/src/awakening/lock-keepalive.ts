/**
 * Keeps the per-agent lock alive while an awakened run is genuinely in flight.
 *
 * The lock is taken with a fixed TTL (AWAKENING_LOCK_TTL_MS, default 20 min)
 * and released by the result callback. Nothing refreshed it, so a run longer
 * than the TTL lost its lock mid-flight; the next tick then acquired cleanly
 * and dispatched a SECOND run for the same agent — the double post the lock
 * exists to prevent.
 *
 * The tick already runs every minute on every pod, so it is the refresher:
 * for each awakening run row that has a session and no completedAt, extend the
 * lock — but only if that session still holds it (refreshAgentLock is a
 * compare-and-PEXPIRE), so a stale row can never extend a newer run's lock.
 *
 * Bounded by AWAKENING_MAX_RUN_MS (default 3 h, matching claw's own
 * RUN_QUEUE_MAX_RUN_MS default). A run older than that is treated as dead: we
 * stop refreshing and the lock expires on its own TTL, so a crashed claw pod
 * that never sends a callback cannot block the agent forever.
 */
import { prisma } from "../db.js";
import { refreshAgentLock } from "./lock.js";
import { createLogger } from "../logger.js";

const log = createLogger("awakening-lock-keepalive");

const DEFAULT_MAX_RUN_MS = 3 * 60 * 60_000;
const KEEPALIVE_BATCH = 500;

export function awakeningMaxRunMs(raw: string | undefined = process.env["AWAKENING_MAX_RUN_MS"]): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_RUN_MS;
}

export interface InFlightRun {
  agentId: string;
  sessionId: string | null;
}

export interface KeepaliveDeps {
  findInFlight: (startedAfter: Date, limit: number) => Promise<InFlightRun[]>;
  refresh: (agentId: string, sessionId: string) => Promise<boolean>;
  now: () => number;
}

const defaultDeps: KeepaliveDeps = {
  findInFlight: (startedAfter, limit) =>
    prisma.agentAwakeningRun.findMany({
      where: {
        completedAt: null,
        sessionId: { not: null },
        outcome: { in: ["ran", "shadow"] },
        startedAt: { gte: startedAfter },
      },
      select: { agentId: true, sessionId: true },
      orderBy: { startedAt: "desc" },
      take: limit,
    }),
  refresh: (agentId, sessionId) => refreshAgentLock(agentId, sessionId),
  now: () => Date.now(),
};

/** Returns how many locks were actually extended. Never throws. */
export async function refreshInFlightAwakeningLocks(deps: KeepaliveDeps = defaultDeps): Promise<number> {
  let rows: InFlightRun[];
  try {
    rows = await deps.findInFlight(new Date(deps.now() - awakeningMaxRunMs()), KEEPALIVE_BATCH);
  } catch (err) {
    log.warn(`[awakening] keepalive scan failed: ${err instanceof Error ? err.message : err}`);
    return 0;
  }
  let refreshed = 0;
  for (const row of rows) {
    if (!row.sessionId) continue;
    if (await deps.refresh(row.agentId, row.sessionId).catch(() => false)) refreshed++;
  }
  return refreshed;
}
