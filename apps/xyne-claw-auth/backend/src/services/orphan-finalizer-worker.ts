import { CONFIG } from "../config.js";
import { errMsg } from "../lib/errors.js";
import { prisma } from "../db.js";
import { createLogger } from "../logger.js";
import { finalizeOrphanedRun } from "./orphan-run-finalizer.js";

const log = createLogger("orphan-finalizer");

const ENABLED = process.env["ORPHAN_FINALIZER_ENABLED"] !== "false";
const INTERVAL_MS = Number(process.env["ORPHAN_FINALIZER_INTERVAL_MS"] ?? 600_000);
const MIN_AGE_MS = Number(process.env["ORPHAN_FINALIZER_MIN_AGE_MS"] ?? 1_800_000);
const ERROR = "interrupted (orphaned run)";

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

export function initOrphanFinalizerWorker(): void {
  if (!ENABLED) {
    log.info("[orphan-finalizer] disabled");
    return;
  }
  if (timer) return;
  log.info(`[orphan-finalizer] starting, interval=${INTERVAL_MS}ms, minAge=${MIN_AGE_MS}ms`);
  timer = setInterval(() => { void tickOnce(); }, INTERVAL_MS);
  timer.unref?.();
  setTimeout(() => { void tickOnce(); }, 30_000).unref?.();
}

export function closeOrphanFinalizerWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

async function runtimeHasAnyActiveRuns(): Promise<boolean> {
  try {
    const res = await fetch(`${CONFIG.xyneClawUrl.replace(/\/+$/, "")}/healthz/ready`, {
      method: "GET",
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      log.warn(`[orphan-finalizer] runtime readiness check returned HTTP ${res.status}; skipping`);
      return true;
    }
    const body = (await res.json().catch(() => ({}))) as { activeRuns?: unknown };
    return typeof body.activeRuns === "number" ? body.activeRuns > 0 : true;
  } catch (err) {
    log.warn(`[orphan-finalizer] runtime readiness check failed; skipping: ${errMsg(err)}`);
    return true;
  }
}

async function tickOnce(): Promise<void> {
  if (running) {
    log.info("[orphan-finalizer] previous tick still running, skipping");
    return;
  }
  running = true;
  try {
    const cutoff = new Date(Date.now() - MIN_AGE_MS);
    const candidates = await prisma.agentRun.findMany({
      where: { status: "running", startedAt: { lt: cutoff } },
      orderBy: { startedAt: "asc" },
      take: 100,
      select: { sessionId: true, agentSlug: true, userId: true, conversationId: true, startedAt: true },
    });
    if (candidates.length === 0) return;

    // xyne-claw currently exposes active-run count but not a non-mutating
    // per-session liveness route. Be conservative: if any runtime run is live,
    // skip this silent cleanup tick rather than risk aborting a long run.
    if (await runtimeHasAnyActiveRuns()) {
      log.info(`[orphan-finalizer] ${candidates.length} old running row(s) found, but runtime has active runs; skipping`);
      return;
    }

    let finalized = 0;
    const now = Date.now();
    for (const run of candidates) {
      const ok = await finalizeOrphanedRun(run, ERROR, "orphan-finalizer");
      if (!ok) continue;
      finalized++;
      const ageMin = Math.round((now - run.startedAt.getTime()) / 60_000);
      log.info(`[orphan-finalizer] finalized session=${run.sessionId} agent=${run.agentSlug} age=${ageMin}min`);
      // Young orphans (< 2h) are almost always pod-death casualties, not the
      // months-old zombie backlog — count them as inflight kills.
      if (ageMin < 120) log.warn(`[metric] name=inflight_killed kind=count value=1 cause=orphan_finalized agent=${run.agentSlug} session=${run.sessionId}`);
    }
    log.info(`[metric] name=orphan_finalizer_finalized kind=count value=${finalized}`);
  } catch (err) {
    log.error("[orphan-finalizer] tick failed:", errMsg(err));
  } finally {
    running = false;
  }
}
