import { DelayedError, Worker, type Job } from "bullmq";
import { executeRunFromPayload, type InternalRunPayload, type RunOutcome } from "./run-execution.js";
import { abortRunForOwnershipLoss, sendCallback } from "./routes/run.js";
import { gcsDownloadResultMarker } from "./storage.js";
import {
  claimOwnership,
  createOwnerToken,
  fenceSession,
  isOwnedByOther,
  refreshOwnership,
  releaseOwnership,
  registerOwnedSession,
  unregisterOwnedSession,
  unfenceSession,
} from "./run-ownership.js";
import { createLogger } from "./logger.js";
import { metric } from "./metrics.js";
import { SERVER } from "./config.js";
import {
  PRESSURE_CHECK_INTERVAL_MS,
  describePressure,
  isUnderPressure,
  overHighWater,
  underLowWater,
} from "./pressure.js";

const clog = createLogger("run-queue-worker");

const PRESSURE_BACKOFF_BASE_MS = 2_000;
const PRESSURE_BACKOFF_MAX_MS = 30_000;
const PRESSURE_BACKOFF_MAX_EXPONENT = 4;
const OWNER_DEFER_MS = 15_000;

let drainPaused = false;

export function markRunQueueDrainPaused(): void {
  drainPaused = true;
}

function pressureBackoffMs(job: Job<InternalRunPayload>): number {
  const started = typeof job.attemptsStarted === "number" ? job.attemptsStarted : job.attemptsMade;
  const exponent = Math.min(PRESSURE_BACKOFF_MAX_EXPONENT, Math.max(0, started));
  const base = Math.min(PRESSURE_BACKOFF_MAX_MS, PRESSURE_BACKOFF_BASE_MS * 2 ** exponent);
  return Math.floor(base * (1 + Math.random() * 0.25));
}

async function postProgressLabel(payload: InternalRunPayload, toolLabel: string): Promise<void> {
  const dest = payload.progressUrl;
  const sessionId = payload.sessionId;
  if (!dest || !sessionId) return;
  const res = await fetch(dest, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(SERVER.s2sKey ? { "x-s2s-key": SERVER.s2sKey } : {}),
    },
    body: JSON.stringify({
      sessionId,
      toolLabel,
      ...(payload.conversationId ? { conversationId: payload.conversationId } : {}),
      ...(payload.agentSlug ? { agentSlug: payload.agentSlug } : {}),
    }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) {
    clog.warn(`[run-queue] progress label "${toolLabel}" returned ${res.status}`);
  }
}

async function notifyTerminalFailure(job: Job<InternalRunPayload> | undefined, err: Error): Promise<void> {
  if (!job) return;
  const { sessionId, sessionToken, callbackUrl, userId, conversationId, agentSlug, idempotencyKey } = job.data;
  if (!sessionId?.trim() || !sessionToken?.trim() || !callbackUrl) return;
  const stalled = /stalled/i.test(err.message);
  const maxAttempts = job.opts?.attempts ?? 1;
  if (!stalled && job.attemptsMade < maxAttempts) return;
  const marker = await gcsDownloadResultMarker(idempotencyKey ?? sessionId).catch(() => null);
  if (marker) return;
  metric.count("run_queue_terminal_notified", {
    agent: agentSlug ?? "unknown",
    session: sessionId,
    reason: stalled ? "stalled" : "attempts_exhausted",
  });
  clog.error(
    `[run-queue] job terminally failed without a posted result — notifying user session=${sessionId} reason=${stalled ? "stalled" : "attempts_exhausted"} err=${err.message}`,
  );
  await sendCallback(callbackUrl, sessionToken.trim(), {
    sessionId,
    userId: userId ?? null,
    conversationId: conversationId ?? null,
    agentSlug: agentSlug ?? null,
    status: "failed",
    error: stalled
      ? "run_interrupted: the run's executor was lost twice — please retry"
      : `run_interrupted: ${err.message}`,
  });
}

export const RUN_EXECUTION_QUEUE_NAME = "run-execution";

function queueEnabled(): boolean {
  return process.env["XYNE_RUN_QUEUE"] === "1";
}

function connectionOptions(): {
  host: string;
  port: number;
  password?: string;
  tls?: { rejectUnauthorized: boolean };
  maxRetriesPerRequest: null;
} | null {
  const host = process.env["REDIS_HOST"];
  if (!host) return null;
  return {
    host,
    port: Number(process.env["REDIS_PORT"] ?? 6379),
    ...(process.env["REDIS_PASSWORD"] ? { password: process.env["REDIS_PASSWORD"] } : {}),
    ...(process.env["REDIS_TLS"] ? { tls: { rejectUnauthorized: false } } : {}),
    maxRetriesPerRequest: null,
  };
}

export function startRunQueueWorker(): Worker<InternalRunPayload> | null {
  if (!queueEnabled()) return null;
  const connection = connectionOptions();
  if (!connection) {
    clog.error("[run-queue] XYNE_RUN_QUEUE=1 but REDIS_HOST is not set — worker not started");
    return null;
  }

  const worker = new Worker<InternalRunPayload>(
    RUN_EXECUTION_QUEUE_NAME,
    async (job: Job<InternalRunPayload>, token?: string) => {
      const sessionId = job.data.sessionId ?? job.id ?? "unknown";
      const agent = job.data.agentSlug ?? "unknown";
      if (!job.data.sessionId?.trim() || !job.data.sessionToken?.trim()) {
        metric.count("run_queue_invalid_payload", { agent, session: sessionId });
        clog.error(`[run-queue] rejecting job without sessionId/sessionToken session=${sessionId} agent=${agent}`);
        return;
      }
      if (isUnderPressure()) {
        metric.count("run_queue_pressure_rejected", { agent, session: sessionId });
        clog.warn(`[run-queue] under pressure — re-queueing session=${sessionId} ${describePressure()}`);
        await postProgressLabel(job.data, "🕒 Re-queued — will resume shortly").catch(() => {});
        await job.moveToDelayed(Date.now() + pressureBackoffMs(job), token);
        throw new DelayedError();
      }
      const ownerToken = createOwnerToken();
      if (await isOwnedByOther(sessionId, ownerToken)) {
        metric.count("run_queue_owner_alive", { agent, session: sessionId });
        clog.warn(`[run-queue] previous runner still owns session=${sessionId} — deferring takeover`);
        await job.moveToDelayed(Date.now() + OWNER_DEFER_MS, token);
        throw new DelayedError();
      }
      metric.count("run_queue_claimed", { agent, session: sessionId, attempt: job.attemptsMade + 1 });
      await postProgressLabel(job.data, "Working on it...").catch(() => {});
      await claimOwnership(sessionId, ownerToken);
      let fencedOut = false;
      registerOwnedSession(sessionId, ownerToken, () => {
        if (fencedOut) return;
        fencedOut = true;
        fenceSession(sessionId);
        metric.count("run_queue_ownership_lost", { agent, session: sessionId });
        clog.warn(`[run-queue] lost ownership of session=${sessionId} — fencing outputs and aborting`);
        abortRunForOwnershipLoss(sessionId);
      });
      let outcome: RunOutcome;
      try {
        outcome = await executeRunFromPayload(job.data, {
          onDrainRequested: async () => "reschedule",
          isFencedOut: () => fencedOut,
        });
      } finally {
        unregisterOwnedSession(sessionId);
        unfenceSession(sessionId);
        if (!fencedOut) await releaseOwnership(sessionId, ownerToken).catch(() => false);
      }
      if (outcome === "rescheduled") {
        metric.count("run_queue_rescheduled", { agent, session: sessionId });
        await postProgressLabel(job.data, "🕒 Re-queued — will resume shortly").catch(() => {});
        await job.moveToDelayed(Date.now() + 1_000, token);
        throw new DelayedError();
      }
      if (outcome === "failed") {
        metric.count("run_queue_failed", { agent, session: sessionId });
        return;
      }
      metric.count("run_queue_completed", { agent, session: sessionId, outcome });
    },
    {
      connection,
      concurrency: 10_000,
      lockDuration: 120_000,
      maxStalledCount: 1,
    },
  );

  worker.on("error", (err: Error) => {
    clog.warn(`[run-queue] worker error: ${err.message}`);
  });
  worker.on("failed", (job, err) => {
    metric.count("run_queue_failed", {
      agent: job?.data?.agentSlug ?? "unknown",
      session: job?.data?.sessionId ?? job?.id ?? "unknown",
      reason: err instanceof Error ? err.name : "unknown",
    });
    void notifyTerminalFailure(job, err).catch((notifyErr: Error) => {
      clog.warn(`[run-queue] terminal-failure notify failed: ${notifyErr.message}`);
    });
  });

  let pressurePaused = false;
  setInterval(() => {
    if (drainPaused) return;
    if (!pressurePaused && overHighWater()) {
      pressurePaused = true;
      metric.count("run_queue_paused", { reason: "pressure" });
      clog.warn(`[run-queue] pausing intake — ${describePressure()}`);
      void worker.pause(true).catch((err: Error) => {
        pressurePaused = false;
        clog.warn(`[run-queue] pause failed: ${err.message}`);
      });
      return;
    }
    if (pressurePaused && underLowWater()) {
      pressurePaused = false;
      metric.count("run_queue_resumed", { reason: "pressure" });
      clog.info(`[run-queue] resuming intake — ${describePressure()}`);
      worker.resume();
    }
  }, PRESSURE_CHECK_INTERVAL_MS).unref();

  clog.info(`[run-queue] worker started queue=${RUN_EXECUTION_QUEUE_NAME} redis=${connection.host}:${connection.port} concurrency=10000`);
  return worker;
}
