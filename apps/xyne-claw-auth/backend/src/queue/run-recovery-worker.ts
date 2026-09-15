import { Queue, Worker, type Job } from "bullmq";
import { errMsg } from "../lib/errors.js";
import { CONFIG } from "../config.js";
import { redisService } from "../redis.js";
import { prisma } from "../db.js";
import { spacesAppFetch } from "../lib/spaces-api.js";
import { enqueueMessage, type QueuedMessage } from "../lib/message-queue.js";

import { createLogger } from "../logger.js";
const log = createLogger("run-recovery-worker");

const RECOVERY_PREFIX = "run-recovery:";
const SESSION_TO_ROOT_PREFIX = "run-recovery-session:";
const RECOVERY_TTL_SECONDS = 24 * 60 * 60;
const QUEUE_NAME = "agent-run-recovery";

interface RecoveryDispatchPayload {
  userId: string;
  task: string;
  // Stable idempotency key (= rootSessionId) sent to xyne-claw so a re-dispatch
  // of an already-completed run is detected via its GCS result marker and NOT
  // re-executed. Injected in registerRunRecovery.
  idempotencyKey?: string;
  conversationId: string;
  agentSlug: string;
  orgId: string;
  eventType: string;
  traceId: string;
  callbackUrl: string;
  progressUrl: string;
  channelId: string;
  context?: string;
  detached?: boolean;
  /** Experiment context (/experiment). MUST be carried: xyne-claw injects the
   *  experiment-ledger / experiment-review / end-experiment tools ONLY when this
   *  is present on the /run body (routes/run.ts normalizeExperimentContext →
   *  buildExperimentTools). It used to be dropped here — TypeScript silently
   *  strips the excess property when the dispatch payload is stored, so every
   *  recovery re-dispatch (watchdog timeout, drain handoff, lock defer) landed
   *  WITHOUT the tools and the agent could no longer write to its own ledger
   *  ("Tool experiment-review not found"). Long epochs are exactly the runs that
   *  get recovered, so the first restart silently disarmed the experiment. */
  experiment?: {
    id: string;
    epoch: number;
    deadlineAt: string;
    focus?: string;
    mode?: "review";
  };
  /** /record-skill recording refs. Same excess-property-strip hazard as
   *  `experiment` above: the /run handler re-binds these in Redis under the NEW
   *  sessionId on every dispatch, so losing them on a recovery hop leaves
   *  analyze-skill-recording 404ing against the dead session's binding. */
  recordingRefs?: Array<{
    attachmentId: string;
    fileName: string;
    mimeType: string;
    fileSize: number;
  }>;
  agentConfig?: Record<string, unknown>;
  fastMode?: boolean;
  resumedFromHandoff?: boolean;
  __persistedByCaller?: boolean;
  skills?: Array<{ name: string; content: string }>;
  provider?: string;
  providerOrder?: string[];
  subagentProviders?: Record<string, string>;
  providerConfigs?: Record<string, { apiKey: string; model: string; baseUrl?: string; authType?: string }>;
  sessionToken?: string;
  // Two shapes: `data` (base64, inlined) or `gcsRef` (bytes parked in object
  // storage behind XYNE_RUN_ATTACHMENT_REFS). A replayed payload carrying
  // either one still ingests — xyne-claw accepts both unconditionally.
  attachments?: Array<{
    fileName: string;
    mimeType: string;
    data?: string | undefined;
    gcsRef?: string | undefined;
    sizeBytes?: number | undefined;
  }>;
  workspaceId?: string;
  resultForwardUrl?: string;
  resolveMentions?: boolean;
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
  /** Automation/workflow result-forward target. MUST be carried here (not only
   *  in the Redis session) because xyne-claw calls back with its OWN sessionId,
   *  which misses the Redis session keyed by the dispatch id — so /webhook/result
   *  resolves ctx via THIS recovery context. Without it, the result-forward
   *  branch is skipped and the handler tries to post to an empty Spaces channel
   *  (channelId=""), which Spaces 400s ("Validation error") → the automation
   *  never gets its result and the run is retried pointlessly. */
  resultForwardUrl?: string;
  resolveMentions?: boolean;
  /** Mirrors SessionContext.isAutomation — see src/lib/session-context.ts.
   *  Carried through recovery so a replayed automation run still gets the
   *  app-mode Spaces MCP swap even when it has neither externalResultCallback
   *  nor resolveMentions (plain-callback automations set neither). */
  isAutomation?: boolean;
  workspaceId?: string;
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
  /** Count of session_locked deferrals (see deferLockContentionRetry). */
  lockDeferrals?: number;
  /** Count of sandbox_unavailable deferrals (see deferSandboxRetry). */
  sandboxDeferrals?: number;
  dispatchPayload: RecoveryDispatchPayload;
  sessionContext: RecoverySessionContext;
  sessionHistory: string[];
}

type RunRecoveryJobData =
  | { type: "watchdog"; rootSessionId: string; sessionId: string }
  | { type: "dispatch"; rootSessionId: string; reason: string };

let queue: Queue<RunRecoveryJobData> | undefined;
let worker: Worker<RunRecoveryJobData> | undefined;

/**
 * Has this run already produced a terminal result? xyne-claw writes a result
 * marker to GCS (claw-results/<idempotencyKey>.json) the moment a run finishes,
 * BEFORE the result callback — which a deploy/SIGTERM can drop. The marker is
 * the deploy-survivable source of truth for "this finished". If present, a
 * (re-)dispatch would re-run already-completed, side-effecting work — so we
 * skip it (the 2026-06-11 "completed sessions re-ran on restart" incident).
 * Returns false on missing/unreadable marker (safe → allow the retry).
 */
async function runAlreadyCompleted(idempotencyKey: string): Promise<boolean> {
  try {
    const { gcsService } = await import("../services/storageService.js");
    const buf = await gcsService.getFileBuffer(`claw-results/${idempotencyKey}.json`);
    const marker = JSON.parse(buf.toString("utf8")) as { status?: string };
    return marker.status === "completed";
  } catch {
    return false; // 404 / unreadable → treat as not-completed → allow retry
  }
}

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

function recoveryIdempotencyKey(state: RunRecoveryState): string {
  return state.dispatchPayload.idempotencyKey ?? state.rootSessionId;
}

function isSessionLockedFailure(error?: string | null): boolean {
  return error === "session_locked" || error?.includes("session_locked") === true;
}

/** A writable dev sandbox could not be provisioned: the agent-sandbox operator
 *  had no warm capacity to bind AND the kata node pool was at max nodes. Emitted
 *  by sandbox-repo-setup → run.ts as error:"sandbox_unavailable". Unlike
 *  session_locked (a peer run holds this conversation's lock), capacity here is
 *  owned by the operator + node autoscaler, so we defer and re-dispatch the same
 *  run until a SandboxClaim binds. */
function isSandboxUnavailableFailure(error?: string | null): boolean {
  return error === "sandbox_unavailable" || error?.includes("sandbox_unavailable") === true;
}

/** Failures a retry can never fix.
 *
 *  The GCS archive guard is the motivating case: claw refuses to run when it
 *  finds a NEWER conversation archive than the one it holds, because running
 *  would clobber it. That refusal is a deliberate safety stop, not a transient
 *  fault — re-dispatching just hits the same guard, so it burned all three
 *  attempts and then told the user the request "still failed" (2026-08-18
 *  session 988ef507). Exhaust immediately instead, with the real reason. */
function isNonRetryableFailure(error?: string | null): boolean {
  if (!error) return false;
  return (
    error.includes("Failed to restore newer GCS archive") ||
    error.includes("refusing to run again")
  );
}

/**
 * Did any attempt in this run's history actually DELIVER?
 *
 * Exhaustion is decided from recovery state, which knows nothing about whether
 * a retry produced a result — so a thread could receive two finished designs
 * and still be told the request failed 3/3 times (2026-08-18 /design thread).
 * A completed run carrying a non-empty result is proof the user got an answer;
 * the alarming card is then worse than silence. Best-effort: a query failure
 * must never suppress a legitimate warning, so it returns false.
 */
async function anyAttemptDelivered(state: RunRecoveryState): Promise<boolean> {
  const sessions = [...new Set([state.rootSessionId, ...state.sessionHistory])];
  if (sessions.length === 0) return false;
  try {
    const { prisma } = await import("../db.js");
    const delivered = await prisma.agentRun.count({
      where: { sessionId: { in: sessions }, status: "completed", NOT: { result: null } },
    });
    return delivered > 0;
  } catch (err) {
    log.warn(
      `[run-recovery] delivered-check failed root=${state.rootSessionId}: ${errMsg(err)}`,
    );
    return false;
  }
}

/** Scheduled fires use a one-shot `scheduled_<jobId>_<ts>` conversationId. The
 *  mid-run FIFO for such a key is NEVER drained (no inbound message targets it
 *  and /scheduled-jobs/:id/result has no drain), so lock-contended scheduled
 *  runs must be re-dispatched on a delay instead of queued. */
function isOneShotScheduledConversation(conversationId: string | undefined): boolean {
  return typeof conversationId === "string" && conversationId.startsWith("scheduled_");
}

const LOCK_CONTENTION_RETRY_DELAY_MS = Number(process.env["LOCK_CONTENTION_RETRY_DELAY_MS"] ?? 120_000);
/** Interactive (Digital Twin / approval-mode) contention resolves fast — the
 *  holder is a live mention run finishing in seconds, not a 15-min scheduled
 *  job — so re-dispatch a starved follow-up tag far sooner than the scheduled
 *  default. A mentioned user shouldn't wait ~2 min for their second tag to get
 *  a draft. Kept comfortably above the runtime's own in-claw lock wait
 *  (SESSION_LOCK_WAIT_MS, ~25s) so we don't churn re-dispatches while the holder
 *  is still mid-run. */
const INTERACTIVE_LOCK_RETRY_DELAY_MS = Number(process.env["INTERACTIVE_LOCK_RETRY_DELAY_MS"] ?? 30_000);
/** Hard cap on lock-contention deferrals. The runtime session lock TTL is 15
 *  min, so the holder either finishes or its lock expires well within
 *  10 × 2 min; the cap only guards against a pathological refresh loop. */
const MAX_LOCK_DEFERRALS = 10;

/** Re-schedule a lock-contended run's dispatch after a delay, WITHOUT
 *  consuming a retry attempt. dispatchRetry's runAlreadyCompleted check exits
 *  the loop as soon as the lock-holding original finishes and writes its
 *  marker. Returns false when the deferral cap is hit (caller exhausts). */
async function deferLockContentionRetry(
  state: RunRecoveryState,
  delayMs: number = LOCK_CONTENTION_RETRY_DELAY_MS,
): Promise<boolean> {
  state.lockDeferrals = (state.lockDeferrals ?? 0) + 1;
  if (state.lockDeferrals > MAX_LOCK_DEFERRALS) return false;
  state.retryScheduled = true;
  state.lastHeartbeatAt = Date.now();
  await saveState(state);
  await scheduleDispatch(state.rootSessionId, "session_locked — waiting for lock holder", delayMs);
  log.info(`[run-recovery] lock contention deferred root=${state.rootSessionId} deferral=${state.lockDeferrals}/${MAX_LOCK_DEFERRALS} retryInMs=${delayMs}`);
  return true;
}

/** Re-schedule a run that could not get a write sandbox, WITHOUT consuming a
 *  retry attempt — same idempotency guarantee as deferLockContentionRetry
 *  (dispatchRetry's runAlreadyCompleted marker prevents a double run if the
 *  original later completes). Returns false when the deferral cap is hit so the
 *  caller can exhaust with a clear message. */
/** Tell the thread ONCE that the run is parked waiting for sandbox capacity.
 *  A defer can last minutes (maxSandboxDeferrals x sandboxRetryDelayMs) and the
 *  run terminates before the model replies, so without this the user sees a
 *  mention that produced nothing and re-tags — the exact behaviour this whole
 *  feature exists to remove. Posted on the FIRST deferral only (no spam), and
 *  only for conversation-mode runs that have somewhere to post. Best-effort:
 *  a failed notice must never block the deferral itself. */
async function notifySandboxDeferred(state: RunRecoveryState): Promise<void> {
  const ctx = state.sessionContext;
  if (ctx.responseMode !== "conversation" || !ctx.conversationId || !ctx.channelId) return;
  const waitMinutes = Math.round((CONFIG.maxSandboxDeferrals * CONFIG.sandboxRetryDelayMs) / 60_000);
  await spacesAppFetch("/chat/postMessage", {
    channelId: ctx.channelId,
    conversationId: ctx.conversationId,
    markdownText:
      "⏳ Waiting for a dev sandbox — all of them are busy right now. " +
      `I'll pick this up automatically as soon as one frees (up to ~${waitMinutes} min); no need to re-tag me.`,
    userId: ctx.spacesAppUserId,
    metadata: { contentFormat: "markdown" },
  }, ctx.appToken);
}

async function deferSandboxRetry(
  state: RunRecoveryState,
  delayMs: number = CONFIG.sandboxRetryDelayMs,
): Promise<boolean> {
  state.sandboxDeferrals = (state.sandboxDeferrals ?? 0) + 1;
  if (state.sandboxDeferrals > CONFIG.maxSandboxDeferrals) return false;
  state.retryScheduled = true;
  state.lastHeartbeatAt = Date.now();
  await saveState(state);
  await scheduleDispatch(state.rootSessionId, "sandbox_unavailable — waiting for write capacity", delayMs);
  if (state.sandboxDeferrals === 1) {
    await notifySandboxDeferred(state).catch((err) => {
      log.warn(`[run-recovery] sandbox-deferred notice failed root=${state.rootSessionId}: ${errMsg(err)}`);
    });
  }
  log.info(`[run-recovery] sandbox unavailable deferred root=${state.rootSessionId} deferral=${state.sandboxDeferrals}/${CONFIG.maxSandboxDeferrals} retryInMs=${delayMs}`);
  return true;
}

async function enqueueLockContentionRun(state: RunRecoveryState): Promise<boolean> {
  const { dispatchPayload, sessionContext } = state;
  if (sessionContext.responseMode !== "conversation") return false;
  if (!dispatchPayload.conversationId || !dispatchPayload.agentSlug || !dispatchPayload.task) return false;
  const workspaceId = dispatchPayload.workspaceId ?? sessionContext.workspaceId;
  const queuedMsg: QueuedMessage = {
    eventId: `lock:${state.rootSessionId}`,
    conversationId: dispatchPayload.conversationId,
    channelId: dispatchPayload.channelId || sessionContext.channelId,
    ...(sessionContext.channelName ? { channelName: sessionContext.channelName } : {}),
    userId: dispatchPayload.userId,
    ...(sessionContext.senderName ? { senderName: sessionContext.senderName } : {}),
    agentSlug: dispatchPayload.agentSlug,
    orgId: dispatchPayload.orgId,
    ...(workspaceId ? { workspaceId } : {}),
    task: dispatchPayload.task,
    eventType: dispatchPayload.eventType,
    ...(dispatchPayload.context ? { context: dispatchPayload.context } : {}),
    ...(sessionContext.resultForwardUrl ? { resultForwardUrl: sessionContext.resultForwardUrl } : {}),
    ...(sessionContext.resolveMentions ? { resolveMentions: sessionContext.resolveMentions } : {}),
    // Keep the experiment context across the queue hop, or the drained run comes
    // back without its ledger tools (see RecoveryDispatchPayload.experiment).
    ...(dispatchPayload.experiment ? { experiment: dispatchPayload.experiment } : {}),
    // Keep recording refs across the hop, or the drained /record-skill run
    // re-dispatches with no Redis binding and analyze-skill-recording 404s.
    ...(dispatchPayload.recordingRefs?.length ? { recordingRefs: dispatchPayload.recordingRefs } : {}),
    // This run already dispatched once (and persisted its user ChatMessage) before
    // hitting session_locked — the drain re-dispatch must NOT re-persist it, or the
    // retried turn shows up as a duplicate root user row (a branch).
    alreadyPersisted: true,
    ts: Date.now(),
  };
  const enq = await enqueueMessage(queuedMsg);
  log.info(`[run-recovery] lock contention queued root=${state.rootSessionId} conv=${queuedMsg.conversationId} agent=${queuedMsg.agentSlug} enqueued=${enq.enqueued} deduped=${enq.deduped} full=${enq.full} pos=${enq.position}`);
  return enq.enqueued || enq.deduped;
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

/**
 * The session a run is CURRENTLY executing under, given the session it was
 * originally dispatched as. A run that exceeds claw's turn limit doesn't end —
 * it is re-dispatched under a fresh sessionId and the chain is recorded in
 * `sessionHistory`. Callers that poll a dispatched run (the error-pipeline
 * runner) must follow that chain, or they read the ORIGINAL row — finalized
 * empty at the re-dispatch — and report "no response" while the real answer
 * lands on the continuation.
 *
 * Returns null when the session isn't tracked, or the newest session when it
 * is (== the argument itself if there was no re-dispatch), so it's authoritative
 * identity rather than a guess based on timing.
 */
export async function getLatestSessionForRun(sessionId: string): Promise<string | null> {
  const rootSessionId = await getRecoveryRootSessionId(sessionId);
  if (!rootSessionId) return null;
  const state = await loadState(rootSessionId);
  if (!state) return null;
  return state.sessionHistory[state.sessionHistory.length - 1] ?? rootSessionId;
}

export async function getRecoveryContextForSession(sessionId: string): Promise<RecoverySessionContext | null> {
  const rootSessionId = await getRecoveryRootSessionId(sessionId);
  if (!rootSessionId) return null;
  const state = await loadState(rootSessionId);
  return state?.sessionContext ?? null;
}

/** True while a handoff continuation or its scheduled retry can still produce a result. */
export async function hasActiveRunRecovery(sessionId: string): Promise<boolean> {
  const rootSessionId = await getRecoveryRootSessionId(sessionId);
  if (!rootSessionId) return false;
  const state = await loadState(rootSessionId);
  return state?.status === "running";
}

/**
 * Cancel recovery for a run the user explicitly stopped (`/stop`).
 *
 * Without this, `/stop` aborts the in-flight run but recovery keeps watching it:
 * the aborted run stops heart-beating, the watchdog fires "no heartbeat before
 * timeout", `runAlreadyCompleted` finds no "completed" marker (there is none —
 * it was cancelled, not finished), so recovery RETRIES it. The retry re-dispatches
 * minutes later as a fresh session and posts anyway — silently defeating `/stop`.
 *
 * We flip the state terminal FIRST (so any already-queued watchdog/dispatch that
 * fires before we finish short-circuits on the `status !== "running"` guard), then
 * drop the pending watchdog + dispatch jobs. Idempotent; safe to call on a run
 * that has no recovery state (returns false).
 */
export async function cancelRunRecovery(sessionId: string): Promise<boolean> {
  const rootSessionId = await getRecoveryRootSessionId(sessionId);
  if (!rootSessionId) return false;
  const state = await loadState(rootSessionId);
  if (!state || state.status !== "running") return false;

  state.status = "exhausted";
  state.retryScheduled = false;
  state.lastError = "cancelled by user (/stop)";
  await saveState(state);

  // Remove watchdogs for every session we've watched (active + historical
  // retries) plus the pending dispatch job, so nothing re-fires.
  const sessions = new Set<string>([state.activeSessionId, ...state.sessionHistory]);
  await Promise.all<unknown>([
    ...[...sessions].map((sid) => removeWatchdog(rootSessionId, sid)),
    getQueue()
      .getJob(dispatchJobId(rootSessionId))
      .then((job) => (job ? job.remove() : undefined)),
  ]).catch((err) =>
    log.warn(`[run-recovery] cancel cleanup partial for root=${rootSessionId}: ${errMsg(err)}`),
  );

  log.info(`[run-recovery] cancelled recovery root=${rootSessionId} via /stop (dropped watchdog + dispatch)`);
  return true;
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
  const tail = isSessionLockedFailure(state.lastError)
    ? "Another task was already running in this thread, so this request could not start. Please re-send your message after the current task finishes."
    : "Some application issue is happening while running this query. Admins will get back to you.";
  // "I retried **0/2** times … but it still failed" reads absurd and alarms
  // users — at zero retries the run was interrupted and could not even be
  // redispatched (handoff/dispatch failure), which is a different story than
  // burning through real retries.
  const headline =
    state.retriesUsed > 0
      ? `I retried this request **${state.retriesUsed}/${state.maxRetries}** times after interruptions, but it still failed.`
      : "This request was interrupted and could not be resumed automatically.";
  const message = [
    "⚠️ **Run recovery exhausted**",
    "",
    headline,
    `Session ID: \`${state.activeSessionId}\``,
    `Root Session ID: \`${state.rootSessionId}\``,
    "",
    tail,
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

  // If any attempt actually answered, the user already has what they asked for
  // and a "recovery exhausted" card just tells them the service is broken while
  // its output sits above it. Record it, don't announce it.
  if (await anyAttemptDelivered(state)) {
    log.info(
      `[run-recovery] exhausted but an attempt delivered root=${state.rootSessionId} reason="${reason}" — suppressing user-facing notice`,
    );
    return;
  }

  await notifyExhausted(state).catch((err) => {
    log.warn("[run-recovery] Failed to notify exhausted run:", errMsg(err));
  });
}

async function dispatchRetry(rootSessionId: string, reason: string): Promise<void> {
  const state = await loadState(rootSessionId);
  if (!state || state.status !== "running") return;

  // Idempotency: the run may have actually FINISHED and just lost its
  // completion callback. Don't re-dispatch finished work — mark completed.
  if (await runAlreadyCompleted(recoveryIdempotencyKey(state))) {
    state.status = "completed";
    state.retryScheduled = false;
    await saveState(state);
    await removeWatchdog(state.rootSessionId, state.activeSessionId).catch(() => {});
    log.info(`[run-recovery] root=${rootSessionId} already completed (result marker present) — skipping retry`);
    return;
  }

  if (state.retriesUsed >= state.maxRetries) {
    await markExhausted(state, reason);
    return;
  }

  state.retryScheduled = false;
  state.retriesUsed += 1;
  state.lastError = reason;
  await saveState(state);

  try {
    if (typeof state.dispatchPayload.orgId !== "string" || !state.dispatchPayload.orgId) {
      await markExhausted(state, "retry dispatch missing orgId");
      return;
    }
    // The original dispatch already persisted the user message. For an
    // approval-mode (twin) re-dispatch tell /run to skip re-persisting it, so a
    // retried tag doesn't duplicate the user's turn (and spawn a branch) in chat.
    const redispatchBody = {
      ...state.dispatchPayload,
      ...(state.sessionContext.responseMode !== "conversation" ? { __skipUserMessagePersist: true } : {}),
    };
    const runRes = await fetch(`${CONFIG.internalUrl}/claw/api/v1/internal/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
      },
      body: JSON.stringify(redispatchBody),
      signal: AbortSignal.timeout(30_000),
    });

    const body = (await runRes.json()) as { success: boolean; sessionId?: string; error?: string };
    if (!runRes.ok || !body.success || !body.sessionId) {
      const err = body.error ?? `HTTP ${runRes.status}`;
      if (isSessionLockedFailure(err)) {
        state.retriesUsed = Math.max(0, state.retriesUsed - 1);
        state.lastError = err;
        if (state.dispatchPayload.resumedFromHandoff === true) {
          if (await deferLockContentionRetry(state)) return;
          await markExhausted(state, "session_locked after handoff (lock never released)");
          return;
        }
        const isInteractiveApproval = state.sessionContext.responseMode !== "conversation";
        if (isOneShotScheduledConversation(state.dispatchPayload.conversationId) || isInteractiveApproval) {
          // Scheduled run colliding with its own still-running original, OR an
          // approval-mode twin tag (the FIFO's redispatch is conversation-mode
          // only and would drop/miscontextualize it): defer a full-payload
          // re-dispatch. runAlreadyCompleted exits the loop once the holder
          // finishes.
          if (await deferLockContentionRetry(state, isInteractiveApproval ? INTERACTIVE_LOCK_RETRY_DELAY_MS : LOCK_CONTENTION_RETRY_DELAY_MS)) return;
          await markExhausted(state, "session_locked (lock never released)");
          return;
        }
        state.status = "completed";
        state.retryScheduled = false;
        state.lastHeartbeatAt = Date.now();
        await enqueueLockContentionRun(state).catch((enqueueErr) => {
          log.warn(`[run-recovery] lock contention enqueue failed root=${state.rootSessionId}: ${errMsg(enqueueErr)}`);
        });
        await saveState(state);
        await removeWatchdog(state.rootSessionId, state.activeSessionId).catch(() => {});
        return;
      }
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

    log.info(`[run-recovery] Retry dispatched root=${state.rootSessionId} attempt=${state.retriesUsed}/${state.maxRetries} newSession=${newSessionId}`);
  } catch (err) {
    const errorMsg = errMsg(err);
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

/**
 * Re-arm watchdogs from the durable Redis state on startup.
 *
 * The recovery state (status="running", lastHeartbeatAt, timeoutMs, …) lives in
 * Redis and survives a restart, but the WATCHDOG is a BullMQ delayed job — and
 * during deploy churn the worker can lose its lock, the watchdog job stalls,
 * and BullMQ marks it `failed: job stalled more than allowable limit` and
 * removes it (removeOnFail). The run then never gets its retry → silent drop
 * (prod: run ff9d59a9 on 2026-06-09T08:22, killed by the 08:09 SIGTERM, watchdog
 * dead-lettered, no recovery). The Redis state is the source of truth, so on
 * startup we scan it and re-schedule a watchdog for every still-running
 * recovery. Idempotent: a live watchdog with the same jobId is deduped by
 * BullMQ; a lost one is recreated.
 */
// Max heartbeat age for a `running` recovery state to still be re-armed on
// startup. A state stuck `running` (its completion was never acked) would
// otherwise be RE-DISPATCHED on every restart — resurrecting an already-finished
// task with no user trigger. Incident 2026-06-11: a deploy re-armed 38 stale
// states → dozens of old sessions re-ran (PRs re-created, sandboxes re-spun).
// Anything older than this is marked `exhausted` instead of re-fired.
const MAX_REARM_AGE_MS = Number(process.env["RUN_RECOVERY_MAX_REARM_AGE_MS"] ?? 60 * 60 * 1000); // 1h

// Emergency kill switch — set RUN_RECOVERY_PURGE_ON_START=true and deploy to
// PURGE all recovery state on boot (stops a runaway re-dispatch loop when you
// can't reach Redis directly). Remove the env on the next deploy.
const PURGE_ON_START = process.env["RUN_RECOVERY_PURGE_ON_START"] === "true";

/** Delete ALL run-recovery state keys. One-shot emergency cleanup. */
async function purgeAllRecoveryState(): Promise<void> {
  const conn = redisService.getConnection();
  let purged = 0;
  try {
    for (const prefix of [RECOVERY_PREFIX, SESSION_TO_ROOT_PREFIX]) {
      let cursor = "0";
      do {
        const [next, keys] = await conn.scan(cursor, "MATCH", `${prefix}*`, "COUNT", 200);
        cursor = next;
        if (keys.length > 0) {
          await conn.del(...keys);
          purged += keys.length;
        }
      } while (cursor !== "0");
    }
    log.warn(`[run-recovery] PURGE_ON_START: deleted ${purged} recovery key(s) — nothing will re-arm this boot. Unset RUN_RECOVERY_PURGE_ON_START after this deploy.`);
  } catch (err) {
    log.error("[run-recovery] purge failed:", errMsg(err));
  }
}

async function rearmRunningRecoveries(): Promise<void> {
  const conn = redisService.getConnection();
  const pattern = `${RECOVERY_PREFIX}*`;
  let cursor = "0";
  let running = 0;
  let rearmed = 0;
  let expired = 0;
  try {
    do {
      const [next, keys] = await conn.scan(cursor, "MATCH", pattern, "COUNT", 200);
      cursor = next;
      for (const key of keys) {
        const rootSessionId = key.slice(RECOVERY_PREFIX.length);
        const state = await loadState(rootSessionId);
        if (!state || state.status !== "running") continue;
        running++;
        // Strongest guard: if the run actually FINISHED (result marker in GCS)
        // but its completion callback was lost, mark it completed — never
        // re-arm/re-dispatch finished work. This is the direct fix for the
        // boot re-arm resurrecting completed runs (2026-06-11).
        if (await runAlreadyCompleted(recoveryIdempotencyKey(state))) {
          state.status = "completed";
          state.retryScheduled = false;
          await saveState(state);
          await removeWatchdog(state.rootSessionId, state.activeSessionId).catch(() => {});
          expired++;
          continue;
        }
        // Guard against resurrecting a state that's been `running` far too long
        // (its completion ack was lost). Re-dispatching it re-runs a finished
        // task. Mark it exhausted so it can never re-fire on this or any future
        // restart.
        const age = Date.now() - state.lastHeartbeatAt;
        if (age > MAX_REARM_AGE_MS) {
          state.status = "exhausted";
          state.retryScheduled = false;
          state.lastError = `stale on startup re-arm (heartbeat ${Math.round(age / 60000)}m old) — not resurrected`;
          await saveState(state);
          await removeWatchdog(state.rootSessionId, state.activeSessionId).catch(() => {});
          expired++;
          continue;
        }
        // Fire after the remaining timeout window; clamp so a long-stale run
        // (heartbeat older than timeoutMs) gets checked almost immediately.
        const remaining = Math.max(1_000, state.timeoutMs - age);
        await scheduleWatchdog(state.rootSessionId, state.activeSessionId, remaining);
        rearmed++;
      }
    } while (cursor !== "0");
    if (running > 0) {
      log.info(`[run-recovery] Startup re-arm: re-scheduled ${rearmed}/${running} running recoveries (${expired} stale → exhausted)`);
    }
  } catch (err) {
    log.error("[run-recovery] Startup re-arm scan failed:", errMsg(err));
  }
}

export function initRunRecoveryWorker(): void {
  if (worker) return;
  worker = new Worker<RunRecoveryJobData>(QUEUE_NAME, processRecoveryJob, {
    connection: redisService.getConnection(),
    concurrency: 3,
    // Tolerate transient stalls during deploy/restart churn before failing a
    // job — a single missed lock-renewal (which happens on graceful shutdown)
    // shouldn't dead-letter a watchdog. The startup re-arm scan below is the
    // durable backstop, but this avoids losing the job in the first place.
    maxStalledCount: 3,
  });

  worker.on("failed", (job, err) => {
    log.error(`[run-recovery] Job ${job?.id} failed:`, err.message);
  });

  worker.on("error", (err) => {
    log.error("[run-recovery] Worker error:", err.message);
  });

  // Emergency: purge all recovery state instead of re-arming (runaway loop).
  // Otherwise re-arm any in-flight recoveries whose BullMQ watchdog was lost
  // across a restart. Fire-and-forget — never block worker startup.
  if (PURGE_ON_START) {
    void purgeAllRecoveryState();
  } else {
    void rearmRunningRecoveries();
  }

  log.info("[run-recovery] Worker started");
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
    // Stamp one stable idempotency key onto every retry dispatch so xyne-claw
    // skips re-execution if the original run already completed.
    dispatchPayload: { ...params.dispatchPayload, idempotencyKey: params.dispatchPayload.idempotencyKey ?? params.rootSessionId },
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

export type RunRecoveryCallbackDisposition = "untracked" | "active_initial" | "active_continuation" | "stale";

/** Classify callback ownership without mutating recovery state. */
export async function classifyRunRecoveryCallback(sessionId: string): Promise<RunRecoveryCallbackDisposition> {
  const rootSessionId = await getRecoveryRootSessionId(sessionId);
  if (!rootSessionId) return "untracked";
  const state = await loadState(rootSessionId);
  if (!state) return "untracked";
  if (state.status !== "running" || state.activeSessionId !== sessionId) return "stale";
  return state.retriesUsed > 0 || state.sessionHistory.some((attemptId) => attemptId !== state.rootSessionId)
    ? "active_continuation"
    : "active_initial";
}

export async function handleRunCompletion(sessionId: string, status: "completed" | "failed", error?: string): Promise<{ retried: boolean; exhausted: boolean; rootSessionId: string; retriesUsed: number; maxRetries: number; terminalDrop?: boolean; stale?: boolean } | null> {
  const rootSessionId = await getRecoveryRootSessionId(sessionId);
  if (!rootSessionId) return null;

  const state = await loadState(rootSessionId);
  if (!state) return null;

  // A callback from a superseded physical attempt, or a duplicate callback
  // after terminal settlement, must not settle or deliver the logical root.
  if (state.status !== "running" || state.activeSessionId !== sessionId) {
    log.info(
      `[run-recovery] ignoring stale callback root=${rootSessionId} callbackSession=${sessionId} activeSession=${state.activeSessionId} callbackStatus=${status} recoveryStatus=${state.status}`,
    );
    return {
      retried: false,
      exhausted: state.status === "exhausted",
      rootSessionId,
      retriesUsed: state.retriesUsed,
      maxRetries: state.maxRetries,
      terminalDrop: true,
      stale: true,
    };
  }

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

  // Refusals a retry cannot fix: exhaust now rather than spending three
  // attempts re-hitting the same guard and then blaming "interruptions".
  if (status === "failed" && isNonRetryableFailure(error)) {
    await removeWatchdog(state.rootSessionId, state.activeSessionId).catch(() => {});
    await getQueue().getJob(dispatchJobId(state.rootSessionId)).then((job) => (job ? job.remove() : undefined)).catch(() => {});
    await markExhausted(state, error ?? "non-retryable failure");
    return { retried: false, exhausted: true, rootSessionId, retriesUsed: state.retriesUsed, maxRetries: state.maxRetries, terminalDrop: true };
  }

  if (status === "failed" && isSandboxUnavailableFailure(error)) {
    state.lastError = error ?? null;
    await removeWatchdog(state.rootSessionId, state.activeSessionId).catch(() => {});
    if (await deferSandboxRetry(state)) {
      return { retried: true, exhausted: false, rootSessionId, retriesUsed: state.retriesUsed, maxRetries: state.maxRetries };
    }
    await markExhausted(state, "sandbox_unavailable (no write capacity after max deferrals)");
    return { retried: false, exhausted: true, rootSessionId, retriesUsed: state.retriesUsed, maxRetries: state.maxRetries, terminalDrop: true };
  }

  if (status === "failed" && isSessionLockedFailure(error)) {
    state.lastError = error ?? null;
    if (state.dispatchPayload.resumedFromHandoff === true) {
      await removeWatchdog(state.rootSessionId, state.activeSessionId).catch(() => {});
      if (await deferLockContentionRetry(state)) {
        return { retried: true, exhausted: false, rootSessionId, retriesUsed: state.retriesUsed, maxRetries: state.maxRetries };
      }
      await markExhausted(state, "session_locked after handoff (lock never released)");
      return { retried: false, exhausted: true, rootSessionId, retriesUsed: state.retriesUsed, maxRetries: state.maxRetries, terminalDrop: true };
    }
    // Re-dispatch (replaying the FULL original payload) rather than queue into
    // the mid-run FIFO, for the two cases that FIFO can't serve:
    //   - one-shot scheduled convIds — no inbound message ever drains that FIFO.
    //   - approval-mode Digital Twin runs — enqueueLockContentionRun /
    //     redispatchQueuedMessage rebuild a CONVERSATION-mode context, so a twin
    //     follow-up tag routed through the FIFO would lose its approval mode +
    //     per-turn mention context. WORSE, enqueueLockContentionRun no-ops for
    //     non-conversation mode, so before this a second rapid tag on the same
    //     thread was silently DROPPED (marked completed, never retried, no
    //     draft). Deferred re-dispatch keeps the twin-safe payload and lets the
    //     tag deliver once the lock frees — fast, since the holder is a live run.
    const isInteractiveApproval = state.sessionContext.responseMode !== "conversation";
    if (isOneShotScheduledConversation(state.dispatchPayload.conversationId) || isInteractiveApproval) {
      await removeWatchdog(state.rootSessionId, state.activeSessionId).catch(() => {});
      const delayMs = isInteractiveApproval ? INTERACTIVE_LOCK_RETRY_DELAY_MS : LOCK_CONTENTION_RETRY_DELAY_MS;
      if (await deferLockContentionRetry(state, delayMs)) {
        return { retried: true, exhausted: false, rootSessionId, retriesUsed: state.retriesUsed, maxRetries: state.maxRetries };
      }
      await markExhausted(state, "session_locked (lock never released)");
      return { retried: false, exhausted: true, rootSessionId, retriesUsed: state.retriesUsed, maxRetries: state.maxRetries, terminalDrop: true };
    }
    state.status = "completed";
    state.retryScheduled = false;
    state.lastHeartbeatAt = Date.now();
    const recovered = await enqueueLockContentionRun(state).catch((err) => {
      log.warn(`[run-recovery] lock contention enqueue failed root=${state.rootSessionId}: ${errMsg(err)}`);
      return false;
    });
    await saveState(state);
    await removeWatchdog(state.rootSessionId, state.activeSessionId).catch(() => {});
    return {
      retried: false,
      exhausted: false,
      rootSessionId,
      retriesUsed: state.retriesUsed,
      maxRetries: state.maxRetries,
      ...(!recovered ? { terminalDrop: true } : {}),
    };
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
