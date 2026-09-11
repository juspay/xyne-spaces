/**
 * Provider capacity auto-retry.
 *
 * When a run dies because the model provider is over capacity (429 / overloaded
 * / 5xx after fallback), we don't know when it recovers — so instead of making
 * the user come back and re-trigger, we poll: penny-drop the exact model/key
 * (claw's /internal/provider-probe), and the moment it serves again, re-dispatch
 * the original run. Backoff plateaus and gives up after a ~3h cap.
 *
 * Interactive runs get a card ("over capacity, retrying when it's back — or
 * Retry now"); automation runs (no human watching) retry SILENTLY and only
 * surface if they finally give up. The manual buttons live in flow-action.ts
 * (capacity-retry-now / capacity-retry-cancel), which call scheduleRetryNow /
 * cancelProviderRetry here.
 */

import { Queue, Worker, type Job } from "bullmq";
import { errMsg } from "../lib/errors.js";
import { redisService } from "../redis.js";
import { CONFIG } from "../config.js";
import { agentRepository } from "../repositories/index.js";
import { decryptStoredField } from "../surfaces/spaces/client.js";
import { buildCapacityRetryFlow } from "xyne-claw-shared";
import { createLogger } from "../logger.js";

const log = createLogger("provider-retry");

const QUEUE_NAME = "provider-capacity-retry";
const CANCEL_PREFIX = "capacity-retry-cancel:";
/** The re-dispatch payload, stored by token so the "Retry now" button (which
 *  only carries the token) can dispatch without the card holding the task. */
const CTX_PREFIX = "capacity-retry-ctx:";
const CANCEL_TTL_SECONDS = 4 * 60 * 60;
const CTX_TTL_SECONDS = 4 * 60 * 60;

/** Backoff between penny-drops (ms). Plateaus at 15m; index past the end reuses
 *  the last. Short at first (blips clear fast), then patient. */
const BACKOFF_MS = [60_000, 120_000, 300_000, 600_000, 900_000];
/** Give up this long after the first failure, then leave the manual button. */
const MAX_WINDOW_MS = Number(process.env["PROVIDER_RETRY_MAX_WINDOW_MS"] ?? 3 * 60 * 60 * 1000);

function backoffFor(attempt: number): number {
  return BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]!;
}

/** Everything needed to POST the original run to /internal/run again. Captured
 *  at failure time from the run's context. */
export interface RetryRedispatch {
  userId: string;
  task: string;
  agentSlug: string;
  orgId: string;
  conversationId: string;
  channelId: string;
  /** MUST be carried for automation/scheduled runs: claw's read-only tool
   *  gating keys on it (isReadOnlyJob), so a retry without it would hand an
   *  automation WRITE tools where the original run was stripped to read-only. */
  eventType?: string;
  provider?: string;
  fastMode?: boolean;
  /** Automation runs forward their result instead of posting a thread reply. */
  resultForwardUrl?: string;
  /** Preserve experiment/understanding context across the retry. */
  experiment?: Record<string, unknown>;
}

export interface ProviderRetryJob {
  retryToken: string;
  attempt: number;
  startedAt: number;
  /** What to penny-drop. */
  provider: string;
  model?: string;
  automation: boolean;
  redispatch: RetryRedispatch;
  /** Interactive only: the card to update in place. */
  card?: { messageId: string; spacesAppId?: string };
}

let queue: Queue<ProviderRetryJob> | undefined;
let worker: Worker<ProviderRetryJob> | undefined;

function getQueue(): Queue<ProviderRetryJob> {
  if (!queue) {
    queue = new Queue<ProviderRetryJob>(QUEUE_NAME, {
      connection: redisService.getConnection(),
      defaultJobOptions: { attempts: 1, removeOnComplete: true, removeOnFail: true },
    });
  }
  return queue;
}

const jobId = (token: string, attempt: number): string => `capacity-retry:${token}:${attempt}`;
const cancelKey = (token: string): string => `${CANCEL_PREFIX}${token}`;
const ctxKey = (token: string): string => `${CTX_PREFIX}${token}`;

/** The full job minus attempt bookkeeping — enough to dispatch on demand. */
type RetryContext = Pick<ProviderRetryJob, "retryToken" | "provider" | "model" | "automation" | "redispatch" | "card">;

/** Schedule the first penny-drop. Returns the retryToken (also the card id). */
export async function scheduleProviderRetry(params: {
  retryToken: string;
  provider: string;
  model?: string;
  automation: boolean;
  redispatch: RetryRedispatch;
  card?: { messageId: string; spacesAppId?: string };
}): Promise<void> {
  const job: ProviderRetryJob = {
    retryToken: params.retryToken,
    attempt: 0,
    startedAt: Date.now(),
    provider: params.provider,
    ...(params.model ? { model: params.model } : {}),
    automation: params.automation,
    redispatch: params.redispatch,
    ...(params.card ? { card: params.card } : {}),
  };
  const ctx: RetryContext = {
    retryToken: job.retryToken,
    provider: job.provider,
    ...(job.model ? { model: job.model } : {}),
    automation: job.automation,
    redispatch: job.redispatch,
    ...(job.card ? { card: job.card } : {}),
  };
  await redisService.getConnection().set(ctxKey(params.retryToken), JSON.stringify(ctx), "EX", CTX_TTL_SECONDS);
  await getQueue().add("probe", job, {
    delay: backoffFor(0),
    jobId: jobId(params.retryToken, 0),
  });
  log.info(`[capacity-retry] scheduled token=${params.retryToken} provider=${params.provider} automation=${params.automation}`);
}

/** "Retry now" button: dispatch immediately and stop the poller. Returns
 *  whether the dispatch was accepted (false if the token expired). */
export async function retryNowByToken(retryToken: string): Promise<boolean> {
  const raw = await redisService.getConnection().get(ctxKey(retryToken));
  if (!raw) return false;
  const ctx = JSON.parse(raw) as RetryContext;
  await cancelProviderRetry(retryToken);
  return redispatch({ ...ctx, attempt: 0, startedAt: Date.now() });
}

/** User tapped Stop, or a retry succeeded elsewhere: stop polling. */
export async function cancelProviderRetry(retryToken: string): Promise<void> {
  await redisService.getConnection().set(cancelKey(retryToken), "1", "EX", CANCEL_TTL_SECONDS);
  log.info(`[capacity-retry] cancelled token=${retryToken}`);
}

async function isCancelled(retryToken: string): Promise<boolean> {
  return (await redisService.getConnection().get(cancelKey(retryToken))) !== null;
}

/** Penny-drop via claw. Returns the probe state. */
async function probe(job: ProviderRetryJob): Promise<"available" | "capacity" | "permanent"> {
  try {
    const res = await fetch(`${CONFIG.internalUrl}/claw/api/v1/internal/provider-probe`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
      },
      body: JSON.stringify({
        provider: job.provider,
        ...(job.model ? { model: job.model } : {}),
        automation: job.automation,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return "capacity";
    const body = (await res.json()) as { data?: { state?: string } };
    const state = body.data?.state;
    return state === "available" || state === "permanent" ? state : "capacity";
  } catch {
    // Probe transport failure — treat as still-down, keep polling.
    return "capacity";
  }
}

/** Re-POST the original run. Idempotency key = conversation+task so a run that
 *  actually completed elsewhere isn't double-executed. */
async function redispatch(job: ProviderRetryJob): Promise<boolean> {
  const r = job.redispatch;
  try {
    const res = await fetch(`${CONFIG.internalUrl}/claw/api/v1/internal/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
      },
      body: JSON.stringify({
        userId: r.userId,
        task: r.task,
        agentSlug: r.agentSlug,
        orgId: r.orgId,
        conversationId: r.conversationId,
        channelId: r.channelId,
        callbackUrl: `${CONFIG.internalUrl}/claw/api/v1/webhook/result`,
        progressUrl: `${CONFIG.internalUrl}/claw/api/v1/webhook/progress`,
        ...(r.eventType ? { eventType: r.eventType } : {}),
        ...(r.provider ? { provider: r.provider } : {}),
        ...(typeof r.fastMode === "boolean" ? { fastMode: r.fastMode } : {}),
        ...(r.resultForwardUrl ? { resultForwardUrl: r.resultForwardUrl } : {}),
        ...(r.experiment ? { experiment: r.experiment } : {}),
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = (await res.json().catch(() => ({}))) as { success?: boolean };
    return res.ok && body.success === true;
  } catch (err) {
    log.error(`[capacity-retry] redispatch failed token=${job.retryToken}: ${errMsg(err)}`);
    return false;
  }
}

/** Update the interactive card in place. No-op for automation / no card. */
async function updateCard(job: ProviderRetryJob, phase: "retrying" | "exhausted" | "cancelled"): Promise<void> {
  if (!job.card?.messageId) return;
  const agent = await agentRepository.findBySlug(job.redispatch.agentSlug, job.redispatch.orgId).catch(() => null);
  if (!agent?.spacesAppToken || !agent.spacesAppUserId) return;
  const appToken = decryptStoredField(agent.spacesAppToken);
  const flow = buildCapacityRetryFlow(job.provider, {
    agentSlug: job.redispatch.agentSlug,
    channelId: job.redispatch.channelId,
    conversationId: job.redispatch.conversationId,
    userId: job.redispatch.userId,
    retryToken: job.retryToken,
    phase,
  });
  try {
    await fetch(`${CONFIG.spacesInternalUrl}/api/apps/chat/updateMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${appToken}` },
      body: JSON.stringify({
        messageId: job.card.messageId,
        flowJSON: flow,
        userId: agent.spacesAppUserId,
        ...(job.card.spacesAppId ? { appId: job.card.spacesAppId } : {}),
        conversationId: job.redispatch.conversationId,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    log.warn(`[capacity-retry] card update failed token=${job.retryToken}: ${errMsg(err)}`);
  }
}

async function processRetryJob(bullJob: Job<ProviderRetryJob>): Promise<void> {
  const job = bullJob.data;
  if (await isCancelled(job.retryToken)) {
    log.info(`[capacity-retry] token=${job.retryToken} cancelled — dropping`);
    return;
  }

  const state = await probe(job);

  if (state === "available") {
    const ok = await redispatch(job);
    if (ok) {
      await cancelProviderRetry(job.retryToken); // stop any sibling attempts
      await updateCard(job, "retrying");
      log.info(`[capacity-retry] token=${job.retryToken} provider back — re-dispatched (attempt ${job.attempt})`);
      return;
    }
    // Dispatch itself failed (not a capacity issue) — fall through to backoff.
  }

  if (state === "permanent") {
    // A non-self-healing error (bad key, model not allowed). Waiting won't help.
    await updateCard(job, "exhausted");
    log.warn(`[capacity-retry] token=${job.retryToken} permanent probe error — stopping`);
    return;
  }

  // Still down (or redispatch flaked): back off and try again, unless we've hit
  // the give-up window.
  const elapsed = Date.now() - job.startedAt;
  if (elapsed >= MAX_WINDOW_MS) {
    await updateCard(job, "exhausted");
    log.info(`[capacity-retry] token=${job.retryToken} gave up after ${Math.round(elapsed / 60000)}m`);
    return;
  }
  const next = job.attempt + 1;
  await getQueue().add(
    "probe",
    { ...job, attempt: next },
    { delay: backoffFor(next), jobId: jobId(job.retryToken, next) },
  );
}

export function initProviderRetryWorker(): void {
  if (worker) return;
  worker = new Worker<ProviderRetryJob>(QUEUE_NAME, processRetryJob, {
    connection: redisService.getConnection(),
    concurrency: 4,
  });
  worker.on("failed", (job, err) => {
    log.error(`[capacity-retry] job ${job?.id} failed: ${err.message}`);
  });
  log.info("[capacity-retry] worker started");
}

export async function closeProviderRetryWorker(): Promise<void> {
  await worker?.close();
  worker = undefined;
}
