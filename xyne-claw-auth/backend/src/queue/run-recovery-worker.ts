import { Queue, Worker, type Job } from "bullmq";
import { CONFIG } from "../config.js";
import { redisService } from "../redis.js";
import { spacesAppFetch } from "../lib/spaces-api.js";

const RECOVERY_PREFIX = "run-recovery:";
const SESSION_TO_ROOT_PREFIX = "run-recovery-session:";
const RECOVERY_TTL_SECONDS = 24 * 60 * 60;
const QUEUE_NAME = "agent-run-recovery";

interface RecoveryDispatchPayload {
  userId: string;
  task: string;
  conversationId: string;
  agentSlug: string;
  eventType: string;
  traceId: string;
  callbackUrl: string;
  progressUrl: string;
  channelId: string;
  context?: string;
  repoUrl?: string;
  skills?: Array<{ name: string; content: string }>;
  provider?: string;
  subagentProviders?: Record<string, string>;
  providerConfigs?: Record<string, { apiKey: string; model: string; baseUrl?: string; authType?: string }>;
  attachments?: Array<{ fileName: string; mimeType: string; data: string }>;
}

export interface RecoverySessionContext {
  mentionedUserId: string;
  senderId: string;
  senderName: string;
  channelId: string;
  channelName: string;
  conversationId: string;
  task: string;
  agentSlug?: string | undefined;
  responseMode: "conversation" | "approval";
  appToken: string;
  spacesAppId: string;
  spacesAppUserId: string;
  traceId?: string;
  provider?: string;
  chainDepth?: number;
  progressMessageId?: string;
}

interface RunRecoveryState {
  rootSessionId: string;
  activeSessionId: string;
  status: "running" | "completed" | "exhausted";
  retriesUsed: number;
  maxRetries: number;
  timeoutMs: number;
  retryBackoffMs: number;
  lastHeartbeatAt: number;
  retryScheduled: boolean;
  lastError: string | null;
  dispatchPayload: RecoveryDispatchPayload;
  sessionContext: RecoverySessionContext;
  sessionHistory: string[];
}

type RunRecoveryJobData =
  | { type: "watchdog"; rootSessionId: string; sessionId: string }
  | { type: "dispatch"; rootSessionId: string; reason: string };

let queue: Queue<RunRecoveryJobData> | undefined;
let worker: Worker<RunRecoveryJobData> | undefined;

function stateKey(rootSessionId: string): string {
  return `${RECOVERY_PREFIX}${rootSessionId}`;
}

function sessionMapKey(sessionId: string): string {
  return `${SESSION_TO_ROOT_PREFIX}${sessionId}`;
}

function watchdogJobId(rootSessionId: string, sessionId: string): string {
  return `recovery-watchdog-${rootSessionId}-${sessionId}`;
}

function dispatchJobId(rootSessionId: string): string {
  return `recovery-dispatch-${rootSessionId}`;
}

function getQueue(): Queue<RunRecoveryJobData> {
  if (!queue) {
    queue = new Queue<RunRecoveryJobData>(QUEUE_NAME, {
      connection: redisService.getConnection(),
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: true,
      },
    });
  }
  return queue;
}

async function loadState(rootSessionId: string): Promise<RunRecoveryState | null> {
  const raw = await redisService.getConnection().get(stateKey(rootSessionId));
  return raw ? JSON.parse(raw) as RunRecoveryState : null;
}

async function saveState(state: RunRecoveryState): Promise<void> {
  await redisService.getConnection().set(stateKey(state.rootSessionId), JSON.stringify(state), "EX", RECOVERY_TTL_SECONDS);
}

async function mapSessionToRoot(sessionId: string, rootSessionId: string): Promise<void> {
  await redisService.getConnection().set(sessionMapKey(sessionId), rootSessionId, "EX", RECOVERY_TTL_SECONDS);
}

export async function getRecoveryRootSessionId(sessionId: string): Promise<string | null> {
  const mapped = await redisService.getConnection().get(sessionMapKey(sessionId));
  if (mapped) return mapped;
  const fallback = await loadState(sessionId);
  return fallback ? sessionId : null;
}

export async function getRecoveryContextForSession(sessionId: string): Promise<RecoverySessionContext | null> {
  const rootSessionId = await getRecoveryRootSessionId(sessionId);
  if (!rootSessionId) return null;
  const state = await loadState(rootSessionId);
  return state?.sessionContext ?? null;
}

async function scheduleWatchdog(rootSessionId: string, sessionId: string, delayMs: number): Promise<void> {
  if (delayMs <= 0) delayMs = 1_000;
  await getQueue().add(
    "watchdog",
    { type: "watchdog", rootSessionId, sessionId },
    { delay: delayMs, jobId: watchdogJobId(rootSessionId, sessionId) },
  );
}

async function removeWatchdog(rootSessionId: string, sessionId: string): Promise<void> {
  const job = await getQueue().getJob(watchdogJobId(rootSessionId, sessionId));
  if (job) await job.remove();
}

async function scheduleDispatch(rootSessionId: string, reason: string, delayMs: number): Promise<void> {
  await getQueue().add(
    "dispatch",
    { type: "dispatch", rootSessionId, reason },
    { delay: Math.max(0, delayMs), jobId: dispatchJobId(rootSessionId) },
  );
}

async function notifyExhausted(state: RunRecoveryState): Promise<void> {
  if (state.sessionContext.responseMode !== "conversation") return;
  const message = [
    "⚠️ **Run recovery exhausted**",
    "",
    `I retried this request **${state.retriesUsed}/${state.maxRetries}** times after interruptions, but it still failed.`,
    `Session ID: \`${state.activeSessionId}\``,
    `Root Session ID: \`${state.rootSessionId}\``,
    "",
    "Some application issue is happening while running this query. Admins will get back to you.",
  ].join("\n");

  await spacesAppFetch("/chat/postMessage", {
    channelId: state.sessionContext.channelId,
    conversationId: state.sessionContext.conversationId,
    markdownText: message,
    userId: state.sessionContext.spacesAppUserId,
    metadata: { contentFormat: "markdown" },
  }, state.sessionContext.appToken);
}

async function markExhausted(state: RunRecoveryState, reason: string): Promise<void> {
  state.status = "exhausted";
  state.lastError = reason;
  state.retryScheduled = false;
  await saveState(state);
  await removeWatchdog(state.rootSessionId, state.activeSessionId).catch(() => {});
  await notifyExhausted(state).catch((err) => {
    console.warn("[run-recovery] Failed to notify exhausted run:", err instanceof Error ? err.message : String(err));
  });
}

async function dispatchRetry(rootSessionId: string, reason: string): Promise<void> {
  const state = await loadState(rootSessionId);
  if (!state || state.status !== "running") return;

  if (state.retriesUsed >= state.maxRetries) {
    await markExhausted(state, reason);
    return;
  }

  state.retryScheduled = false;
  state.retriesUsed += 1;
  state.lastError = reason;
  await saveState(state);

  try {
    const runRes = await fetch(`${CONFIG.selfUrl}/claw/api/v1/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state.dispatchPayload),
      signal: AbortSignal.timeout(30_000),
    });

    const body = (await runRes.json()) as { success: boolean; sessionId?: string; error?: string };
    if (!runRes.ok || !body.success || !body.sessionId) {
      const err = body.error ?? `HTTP ${runRes.status}`;
      if (state.retriesUsed >= state.maxRetries) {
        await markExhausted(state, `retry dispatch failed: ${err}`);
        return;
      }
      state.retryScheduled = true;
      state.lastError = `retry dispatch failed: ${err}`;
      await saveState(state);
      await scheduleDispatch(state.rootSessionId, state.lastError, state.retryBackoffMs * state.retriesUsed);
      return;
    }

    const newSessionId = body.sessionId;
    state.activeSessionId = newSessionId;
    state.lastHeartbeatAt = Date.now();
    state.sessionHistory.push(newSessionId);
    state.retryScheduled = false;
    await saveState(state);
    await mapSessionToRoot(newSessionId, state.rootSessionId);
    await scheduleWatchdog(state.rootSessionId, newSessionId, state.timeoutMs);

    console.log(`[run-recovery] Retry dispatched root=${state.rootSessionId} attempt=${state.retriesUsed}/${state.maxRetries} newSession=${newSessionId}`);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    if (state.retriesUsed >= state.maxRetries) {
      await markExhausted(state, `retry dispatch exception: ${errorMsg}`);
      return;
    }
    state.retryScheduled = true;
    state.lastError = `retry dispatch exception: ${errorMsg}`;
    await saveState(state);
    await scheduleDispatch(state.rootSessionId, state.lastError, state.retryBackoffMs * state.retriesUsed);
  }
}

async function processRecoveryJob(job: Job<RunRecoveryJobData>): Promise<void> {
  const data = job.data;

  if (data.type === "dispatch") {
    await dispatchRetry(data.rootSessionId, data.reason);
    return;
  }

  const state = await loadState(data.rootSessionId);
  if (!state || state.status !== "running") return;

  if (state.activeSessionId !== data.sessionId) return; // stale watchdog

  const age = Date.now() - state.lastHeartbeatAt;
  if (age < state.timeoutMs) {
    await scheduleWatchdog(state.rootSessionId, state.activeSessionId, state.timeoutMs - age);
    return;
  }

  if (state.retriesUsed >= state.maxRetries) {
    await markExhausted(state, "no heartbeat before timeout");
    return;
  }

  if (state.retryScheduled) return;

  state.retryScheduled = true;
  state.lastError = "no heartbeat before timeout";
  await saveState(state);
  await scheduleDispatch(state.rootSessionId, "no heartbeat before timeout", state.retryBackoffMs * (state.retriesUsed + 1));
}

export function initRunRecoveryWorker(): void {
  if (worker) return;
  worker = new Worker<RunRecoveryJobData>(QUEUE_NAME, processRecoveryJob, {
    connection: redisService.getConnection(),
    concurrency: 3,
  });

  worker.on("failed", (job, err) => {
    console.error(`[run-recovery] Job ${job?.id} failed:`, err.message);
  });

  worker.on("error", (err) => {
    console.error("[run-recovery] Worker error:", err.message);
  });

  console.log("[run-recovery] Worker started");
}

export async function closeRunRecoveryWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = undefined;
  }
  if (queue) {
    await queue.close();
    queue = undefined;
  }
}

export async function registerRunRecovery(params: {
  rootSessionId: string;
  maxRetries: number;
  timeoutMs: number;
  retryBackoffMs: number;
  dispatchPayload: RecoveryDispatchPayload;
  sessionContext: RecoverySessionContext;
}): Promise<void> {
  const state: RunRecoveryState = {
    rootSessionId: params.rootSessionId,
    activeSessionId: params.rootSessionId,
    status: "running",
    retriesUsed: 0,
    maxRetries: Math.max(0, params.maxRetries),
    timeoutMs: Math.max(30_000, params.timeoutMs),
    retryBackoffMs: Math.max(1_000, params.retryBackoffMs),
    lastHeartbeatAt: Date.now(),
    retryScheduled: false,
    lastError: null,
    dispatchPayload: params.dispatchPayload,
    sessionContext: params.sessionContext,
    sessionHistory: [params.rootSessionId],
  };

  await saveState(state);
  await mapSessionToRoot(params.rootSessionId, params.rootSessionId);
  await scheduleWatchdog(params.rootSessionId, params.rootSessionId, state.timeoutMs);
}

export async function touchRunRecovery(sessionId: string): Promise<void> {
  const rootSessionId = await getRecoveryRootSessionId(sessionId);
  if (!rootSessionId) return;
  const state = await loadState(rootSessionId);
  if (!state || state.status !== "running") return;

  state.lastHeartbeatAt = Date.now();
  await saveState(state);
}

export async function handleRunCompletion(sessionId: string, status: "completed" | "failed", error?: string): Promise<{ retried: boolean; exhausted: boolean; rootSessionId: string; retriesUsed: number; maxRetries: number } | null> {
  const rootSessionId = await getRecoveryRootSessionId(sessionId);
  if (!rootSessionId) return null;

  const state = await loadState(rootSessionId);
  if (!state) return null;

  if (status === "completed") {
    state.status = "completed";
    state.lastError = null;
    state.retryScheduled = false;
    state.lastHeartbeatAt = Date.now();
    await saveState(state);
    await removeWatchdog(state.rootSessionId, state.activeSessionId).catch(() => {});
    return { retried: false, exhausted: false, rootSessionId, retriesUsed: state.retriesUsed, maxRetries: state.maxRetries };
  }

  if (state.status !== "running") {
    return { retried: false, exhausted: state.status === "exhausted", rootSessionId, retriesUsed: state.retriesUsed, maxRetries: state.maxRetries };
  }

  state.lastError = error ?? null;
  state.lastHeartbeatAt = Date.now();

  if (state.retriesUsed >= state.maxRetries) {
    await markExhausted(state, error ?? "run failed");
    return { retried: false, exhausted: true, rootSessionId, retriesUsed: state.retriesUsed, maxRetries: state.maxRetries };
  }

  if (!state.retryScheduled) {
    state.retryScheduled = true;
    await saveState(state);
    await scheduleDispatch(state.rootSessionId, error ?? "run failed", state.retryBackoffMs * (state.retriesUsed + 1));
  } else {
    await saveState(state);
  }

  return { retried: true, exhausted: false, rootSessionId, retriesUsed: state.retriesUsed, maxRetries: state.maxRetries };
}
