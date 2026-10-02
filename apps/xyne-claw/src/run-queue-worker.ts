import { DelayedError, Worker, type Job } from "bullmq";
import { executeRunFromPayload, type InternalRunPayload, type RunOutcome } from "./run-execution.js";
import { abortRunForOwnershipLoss, sendCallback } from "./routes/run.js";
import { gcsDownloadResultMarker } from "./storage.js";
import {
  claimOwnership,
  createOwnerToken,
  currentOwnerPod,
  fenceSession,
  inspectOwner,
  refreshOwnership,
  releaseOwnership,
  registerOwnedSession,
  unregisterOwnedSession,
  unfenceSession,
  warmOwnershipClient,
} from "./run-ownership.js";
import { startRunControlSubscriber } from "./run-control.js";
import { RUN_TIMED_OUT, maxRunMs, raceRunDeadline } from "./run-deadline.js";
import { createLogger } from "./logger.js";
import { metric } from "./metrics.js";
import { SERVER, isAllowedCallbackUrl } from "./config.js";
import {
  activeAutomationRuns,
  automationConcurrencyLimit,
  automationDeferMs,
  isAutomationPayload,
  releaseAutomationSlot,
  tryAcquireAutomationSlot,
} from "./automation-cap.js";
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

export async function postProgressLabel(payload: InternalRunPayload, toolLabel: string): Promise<void> {
  const dest = payload.progressUrl;
  const sessionId = payload.sessionId;
  if (!dest || !sessionId) return;
  if (!isAllowedCallbackUrl(dest)) {
    clog.warn(`[run-queue] ignoring non-allowlisted progressUrl session=${sessionId}`);
    return;
  }
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

async function notifyRunTimeout(job: Job<InternalRunPayload>, limitMs: number): Promise<void> {
  const { sessionId, sessionToken, callbackUrl, userId, conversationId, agentSlug, idempotencyKey } = job.data;
  if (!sessionId?.trim() || !sessionToken?.trim() || !callbackUrl) return;
  if ((await job.getState().catch(() => "unknown")) !== "active") return;
  const marker = await gcsDownloadResultMarker(idempotencyKey ?? sessionId).catch(() => null);
  if (marker) return;
  await sendCallback(callbackUrl, sessionToken.trim(), {
    sessionId,
    userId: userId ?? null,
    conversationId: conversationId ?? null,
    agentSlug: agentSlug ?? null,
    status: "failed",
    error: `run_timed_out: the run did not finish within ${Math.round(limitMs / 60000)} minutes and was stopped — please retry`,
  });
}

async function runClaimedJob(
  job: Job<InternalRunPayload>,
  token: string | undefined,
  sessionId: string,
  agent: string,
  ownerToken: string,
  takeoverFrom: string | null,
): Promise<void> {
  if (!(await claimOwnership(sessionId, ownerToken, takeoverFrom))) {
    metric.count("run_queue_claim_lost", { agent, session: sessionId });
    clog.warn(`[run-queue] another runner claimed session=${sessionId} first — deferring`);
    await job.moveToDelayed(Date.now() + OWNER_DEFER_MS, token);
    throw new DelayedError();
  }
  metric.count("run_queue_claimed", { agent, session: sessionId, attempt: job.attemptsMade + 1 });
  await postProgressLabel(job.data, "Working on it...").catch(() => {});
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
  let timedOut = false;
  const limitMs = maxRunMs();
  try {
    const result = await raceRunDeadline(
      executeRunFromPayload(job.data, {
        onDrainRequested: async () => "reschedule",
        isFencedOut: () => fencedOut,
      }),
      limitMs,
    );
    if (result === RUN_TIMED_OUT) {
      timedOut = true;
      fencedOut = true;
      abortRunForOwnershipLoss(sessionId);
      metric.count("run_queue_run_timeout", { agent, session: sessionId });
      clog.error(`[run-queue] run exceeded ${Math.round(limitMs / 60000)}m — abandoning it and releasing ownership session=${sessionId} agent=${agent}`);
      outcome = "failed";
    } else {
      outcome = result;
    }
  } finally {
    unregisterOwnedSession(sessionId);
    unfenceSession(sessionId);
    if (!fencedOut || timedOut) await releaseOwnership(sessionId, ownerToken).catch(() => false);
  }
  if (timedOut) {
    await notifyRunTimeout(job, limitMs).catch((err: Error) => {
      clog.warn(`[run-queue] timeout notify failed session=${sessionId}: ${err.message}`);
    });
    return;
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
}

export const RUN_EXECUTION_QUEUE_NAME = "run-execution";

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
    ...(/^(1|true|yes)$/i.test(process.env["REDIS_TLS"] ?? "") ? { tls: { rejectUnauthorized: false } } : {}),
    maxRetriesPerRequest: null,
  };
}

export function startRunQueueWorker(): Worker<InternalRunPayload> | null {
  const connection = connectionOptions();
  if (!connection) {
    clog.error("[run-queue] REDIS_HOST is not set — run queue worker not started");
    return null;
  }

  warmOwnershipClient();
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
      const { status, holder } = await inspectOwner(sessionId, ownerToken);
      if (status === "alive-other") {
        metric.count("run_queue_owner_alive", { agent, session: sessionId });
        clog.warn(`[run-queue] previous runner still owns session=${sessionId} — deferring takeover`);
        await job.moveToDelayed(Date.now() + OWNER_DEFER_MS, token);
        throw new DelayedError();
      }
      if (status === "dead-other") {
        const deadPod = await currentOwnerPod(sessionId).catch(() => null);
        metric.count("run_queue_owner_dead_takeover", { agent, session: sessionId });
        clog.warn(`[run-queue] owner pod ${deadPod ?? "unknown"} has no alive key — taking over session=${sessionId}`);
      }
      const automation = isAutomationPayload(job.data);
      if (automation) {
        if (!tryAcquireAutomationSlot()) {
          metric.count("run_queue_automation_deferred", { agent, session: sessionId, active: activeAutomationRuns() });
          await job.moveToDelayed(Date.now() + automationDeferMs(), token);
          throw new DelayedError();
        }
        metric.observe("run_queue_automation_wait_ms", Math.max(0, Date.now() - job.timestamp), { agent, active: activeAutomationRuns() });
      }
      try {
        return await runClaimedJob(job, token, sessionId, agent, ownerToken, status === "dead-other" ? holder : null);
      } finally {
        if (automation) releaseAutomationSlot();
      }
    },
    {
      connection,
      concurrency: 10_000,
      lockDuration: 180_000,
      maxStalledCount: 2,
    },
  );

  startRunControlSubscriber();

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

  clog.info(`[run-queue] worker started queue=${RUN_EXECUTION_QUEUE_NAME} redis=${connection.host}:${connection.port} concurrency=10000 automationConcurrency=${automationConcurrencyLimit() || "unlimited"}`);
  return worker;
}
