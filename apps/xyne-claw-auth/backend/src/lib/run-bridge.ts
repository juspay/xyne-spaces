import { randomUUID } from "crypto";
import { CONFIG } from "../config.js";
import { prisma } from "../db.js";
import { errMsg } from "./errors.js";
import { agentRunRepository } from "../repositories/index.js";
import { consumeAlreadyOpenStream } from "./consume-claw-stream.js";
import { mintSessionToken } from "./session-tokens.js";
import { handleRunCompletion } from "../queue/run-recovery-worker.js";
import { fetchClawRunWithRetry } from "./claw-fetch.js";
import { createLogger } from "../logger.js";

const log = createLogger("run");

type AgentRunTriggerSource = "spaces" | "scheduled" | "chat" | "api" | "automation" | "slack" | "heartbeat" | "reflex";

// ── SSE → legacy POST bridge ───────────────────────────────────────────────
// Used by the proxy's SSE-with-translation branch. Consumes claw's open SSE
// response, POSTs each event to the caller's progressUrl, and POSTs the final
// `done` payload to callbackUrl — keeping the legacy fire-and-forget contract
// for callers like webhook.ts / agent-chat.ts while the actual wire to claw
// is one ordered SSE connection.

export interface BridgeForProbeOpts {
  probeRes: { body: ReadableStream<Uint8Array> | null };
  progressUrl: string | undefined;
  callbackUrl: string | undefined;
  sessionId: string;
  /** Per-run HMAC bearer minted by mintSessionToken (bound to {sid, uid}).
   *  Required on the final callback POST — /webhook/result + the per-session
   *  /sessions/:id/result endpoints gate on it via requireResultToken so a
   *  leaked S2S key alone can't post a result for an arbitrary run. Legacy
   *  claw's sendCallback shipped it as x-session-token; the bridge has to
   *  do the same or the receiver rejects with "malformed". */
  sessionToken: string;
  /** Conversation identity from the caller's request body. Threaded into every
   *  bridge POST so /webhook/progress + /webhook/result can fall back to
   *  conv-keyed session lookup when sessionId lookup races against setSession()
   *  or run-recovery (the proximate cause of missing Spaces typing animation
   *  and missing summarize replies). */
  conversationId?: string | undefined;
  agentSlug?: string | undefined;
  eventType?: string | undefined;
  forwardBody: Record<string, unknown>;
}

// Spaces' /webhook/progress only consumes toolInvocation / toolLabel /
// sandboxPreviewUrl — text deltas, reasoning deltas, attachments, and debug
// events are silently dropped. Translating them to localhost POSTs anyway
// stalls the SSE consumer serially behind ~thousands of no-op requests during
// long summarization runs. Detect the Spaces sink by URL suffix and skip the
// noise events at the bridge layer.
function isSpacesWebhookProgressUrl(url: string | undefined): boolean {
  return !!url && /\/webhook\/progress(?:\?|$)/.test(url);
}

export function isScheduledOrAutomationEvent(eventType: unknown): boolean {
  return eventType === "scheduled_job" || eventType === "automation";
}

function scheduledJobIdFromCallback(callbackUrl: string | undefined): string | undefined {
  if (!callbackUrl) return undefined;
  const match = callbackUrl.match(/\/scheduled-jobs\/([^/]+)\/result(?:\?|$)/);
  return match?.[1];
}

function safeIdPart(value: unknown): string {
  const raw = typeof value === "string" && value.trim() ? value.trim() : randomUUID();
  const safe = raw.replace(/[^A-Za-z0-9_-]/g, "_");
  return safe.length > 0 ? safe.slice(0, 110) : randomUUID();
}

function retryIdempotencyKey(forwardBody: Record<string, unknown>): string {
  // REUSE the original key, do not derive a new one: claw's completion marker
  // (claw-results/<key>.json) is written only on success, so with the same key
  // a bridge that died AFTER the run finished replays the completed result
  // instead of re-executing the task (duplicate side effects), and an
  // unfinished run executes normally. A `_retry1`-style suffix would bypass
  // that idempotency backstop entirely.
  return safeIdPart(forwardBody["idempotencyKey"]);
}

async function retryBrokenBridgeOnce(opts: {
  forwardBody: Record<string, unknown>;
  oldSessionId: string;
  callbackUrl: string | undefined;
  reason: string;
}): Promise<boolean> {
  const eventType = opts.forwardBody["eventType"];
  if (!isScheduledOrAutomationEvent(eventType)) return false;
  if (typeof opts.forwardBody["retryOf"] === "string") return false;

  const userId = opts.forwardBody["userId"];
  if (typeof userId !== "string" || !userId) {
    log.warn(`[run] proxy: cannot retry broken bridge; missing userId (session=${opts.oldSessionId})`);
    return false;
  }

  const agentSlug =
    typeof opts.forwardBody["agentSlug"] === "string" ? opts.forwardBody["agentSlug"] : undefined;
  const newSessionId = randomUUID();
  const sessionToken = mintSessionToken({
    sessionId: newSessionId,
    userId,
    ...(agentSlug ? { agentSlug } : {}),
    ttlSeconds: 6 * 60 * 60,
  });
  const newBody = {
    ...opts.forwardBody,
    sessionId: newSessionId,
    sessionToken,
    idempotencyKey: retryIdempotencyKey(opts.forwardBody),
    retryOf: opts.oldSessionId,
    detached: true,
  };

  const oldRun = await prisma.agentRun
    .findUnique({
      where: { sessionId: opts.oldSessionId },
      select: {
        userId: true,
        agentSlug: true,
        orgId: true,
        triggerSource: true,
        task: true,
        conversationId: true,
        scheduledJobId: true,
        channelId: true,
        projectId: true,
        projectName: true,
        metadata: true,
      },
    })
    .catch(() => null);

  try {
    const retryRes = await fetchClawRunWithRetry(
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
        },
        body: JSON.stringify(newBody),
      },
      "bridge-retry-detached",
    );
    const retryBody = (await retryRes.json().catch(() => null)) as {
      success?: boolean;
      sessionId?: string;
      error?: string;
    } | null;
    if (retryRes.status !== 202 || !retryBody?.success || retryBody.sessionId !== newSessionId) {
      log.warn(
        `[run] proxy: bridge retry dispatch rejected old=${opts.oldSessionId} new=${newSessionId} status=${retryRes.status} error=${retryBody?.error ?? "unknown"}`,
      );
      return false;
    }
  } catch (err) {
    log.warn(
      `[run] proxy: bridge retry dispatch failed old=${opts.oldSessionId} new=${newSessionId}: ${errMsg(err)}`,
    );
    return false;
  }

  const retryError = `bridge lost — retried as ${newSessionId}`;
  // Hand the old session's run-recovery state over: mark it completed so the
  // watchdog can't fire a SECOND retry for the same work (automations register
  // recovery at dispatch; without this, bridge-retry + recovery-retry would
  // double-execute the task). The retry session owns delivery from here;
  // retry-once semantics — if IT dies too, the failure surfaces via callback.
  await handleRunCompletion(opts.oldSessionId, "completed").catch((err) =>
    log.warn(
      `[run] proxy: failed to hand off recovery state for bridge-lost run (session=${opts.oldSessionId}): ${errMsg(err)}`,
    ),
  );
  await agentRunRepository
    .finalize(opts.oldSessionId, {
      status: "failed",
      error: retryError,
      result: null,
      fastMode: opts.forwardBody["fastMode"] === true,
    })
    .catch((err) =>
      log.warn(
        `[run] proxy: failed to mark bridge-lost run failed (session=${opts.oldSessionId}): ${errMsg(err)}`,
      ),
    );

  const scheduledJobId = oldRun?.scheduledJobId ?? scheduledJobIdFromCallback(opts.callbackUrl);
  if (scheduledJobId) {
    await prisma.scheduledJobRun
      .updateMany({
        where: { scheduledJobId, sessionId: opts.oldSessionId },
        data: { status: "failed", error: retryError, completedAt: new Date() },
      })
      .catch(() => {});
    await prisma.scheduledJobRun
      .create({
        data: { scheduledJobId, sessionId: newSessionId, status: "started" },
      })
      .catch((err) =>
        log.warn(
          `[run] proxy: failed to create scheduled retry run row job=${scheduledJobId} session=${newSessionId}: ${errMsg(err)}`,
        ),
      );
  }

  if (oldRun) {
    await agentRunRepository
      .start({
        sessionId: newSessionId,
        userId: oldRun.userId,
        agentSlug: oldRun.agentSlug,
        orgId: oldRun.orgId,
        triggerSource: oldRun.triggerSource as AgentRunTriggerSource,
        task: oldRun.task,
        ...(oldRun.conversationId ? { conversationId: oldRun.conversationId } : {}),
        ...(scheduledJobId ? { scheduledJobId } : {}),
        ...(oldRun.channelId ? { channelId: oldRun.channelId } : {}),
        ...(oldRun.projectId ? { projectId: oldRun.projectId } : {}),
        ...(oldRun.projectName ? { projectName: oldRun.projectName } : {}),
        ...(oldRun.metadata != null ? { metadata: oldRun.metadata } : {}),
        fastMode: opts.forwardBody["fastMode"] === true,
      })
      .catch((err) =>
        log.warn(
          `[run] proxy: failed to start retry AgentRun old=${opts.oldSessionId} new=${newSessionId}: ${errMsg(err)}`,
        ),
      );
  }

  log.warn(
    `[run] proxy: ${opts.reason}; retried ${String(eventType)} run old=${opts.oldSessionId} new=${newSessionId}`,
  );
  return true;
}

/** How long a headless run (bridge lost, runtime presumed alive) gets to
 *  finalize via its own callback before we declare it dead. Generous — long
 *  interactive runs are the norm; the orphan-finalizer remains the deep
 *  backstop if claw-auth restarts and loses this in-process timer. */
const HEADLESS_FINALIZE_CHECK_MS = Number(process.env["HEADLESS_FINALIZE_CHECK_MS"] ?? 30 * 60 * 1000);

/** The headless early-return trusts the runtime to finalize via callback —
 *  correct when only the PIPE died. When the RUNTIME died (OOM/crash), no
 *  callback ever comes and interactive runs register no run-recovery, so the
 *  row would sit "running" until the slow orphan sweep. This bounded check
 *  posts the synthetic failed callback only if the row is still running
 *  after the window. Best-effort in-process timer. */
export function armHeadlessFinalizeCheck(opts: {
  sessionId: string;
  sessionToken: string;
  callbackUrl: string | undefined;
  conversationId?: string | undefined;
  agentSlug?: string | undefined;
  eventType?: string | undefined;
  fastMode?: boolean | undefined;
}): void {
  const timer = setTimeout(async () => {
    try {
      const run = await agentRunRepository.findBySessionId(opts.sessionId);
      if (!run || run.status !== "running") return;
      log.warn(
        `[run] proxy: headless run never finalized after ${HEADLESS_FINALIZE_CHECK_MS}ms — posting synthetic failure (session=${opts.sessionId})`,
      );
      log.warn(
        `[metric] name=inflight_killed kind=count value=1 cause=headless_never_finalized agent=${opts.agentSlug ?? "unknown"} session=${opts.sessionId}`,
      );
      await postBrokenSseTerminalCallback({
        callbackUrl: opts.callbackUrl,
        sessionId: opts.sessionId,
        sessionToken: opts.sessionToken,
        conversationId: opts.conversationId,
        agentSlug: opts.agentSlug,
        eventType: opts.eventType,
        fastMode: opts.fastMode,
        logPrefix: "headless run never finalized",
      });
    } catch (err) {
      log.warn(
        `[run] proxy: headless finalize check failed (session=${opts.sessionId}): ${errMsg(err)}`,
      );
    }
  }, HEADLESS_FINALIZE_CHECK_MS);
  timer.unref?.();
}

export async function postBrokenSseTerminalCallback(opts: {
  callbackUrl: string | undefined;
  sessionId: string;
  sessionToken: string;
  conversationId?: string | undefined;
  agentSlug?: string | undefined;
  eventType?: string | undefined;
  fastMode?: boolean | undefined;
  logPrefix: string;
}): Promise<void> {
  if (opts.eventType === "scheduled_job") {
    log.warn(
      `[metric] name=post_broken_sse_terminal_callback eventType=scheduled_job agent=${opts.agentSlug ?? "unknown"} job=${scheduledJobIdFromCallback(opts.callbackUrl) ?? "unknown"}`,
    );
  }
  const body = {
    ...(opts.conversationId !== undefined ? { conversationId: opts.conversationId } : {}),
    ...(opts.agentSlug !== undefined ? { agentSlug: opts.agentSlug } : {}),
    sessionId: opts.sessionId,
    status: "failed",
    error: "sse stream broken",
    ...(opts.fastMode !== undefined ? { fastMode: opts.fastMode === true } : {}),
  };
  if (!opts.callbackUrl) {
    await agentRunRepository
      .finalize(opts.sessionId, {
        status: "failed",
        error: "sse stream broken",
        result: null,
        ...(opts.fastMode !== undefined ? { fastMode: opts.fastMode === true } : {}),
      })
      .catch((err) =>
        log.warn(
          `[run] proxy: failed to finalize broken SSE without callback (session=${opts.sessionId}): ${errMsg(err)}`,
        ),
      );
    return;
  }

  try {
    const cbRes = await fetch(opts.callbackUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
        ...(opts.sessionToken ? { "x-session-token": opts.sessionToken } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!cbRes.ok) {
      const text = await cbRes.text().catch(() => "");
      throw new Error(`HTTP ${cbRes.status}: ${text.slice(0, 300)}`);
    }
    log.warn(`[run] proxy: ${opts.logPrefix}; posted failed callback (session=${opts.sessionId})`);
  } catch (err) {
    log.warn(
      `[run] proxy: ${opts.logPrefix}; failed callback POST failed (session=${opts.sessionId}): ${errMsg(err)}`,
    );
    await agentRunRepository
      .finalize(opts.sessionId, {
        status: "failed",
        error: "sse stream broken",
        result: null,
        ...(opts.fastMode !== undefined ? { fastMode: opts.fastMode === true } : {}),
      })
      .catch((finalizeErr) =>
        log.warn(
          `[run] proxy: failed direct finalize after broken SSE callback miss (session=${opts.sessionId}): ${errMsg(finalizeErr)}`,
        ),
      );
  }
}

export async function runBridgeForProbeResponse(opts: BridgeForProbeOpts): Promise<void> {
  const {
    probeRes,
    progressUrl,
    callbackUrl,
    sessionId,
    sessionToken,
    conversationId,
    agentSlug,
    eventType,
    forwardBody,
  } = opts;
  if (!probeRes.body) {
    log.warn(`[run] proxy: bridge has no upstream body to consume (sessionId=${sessionId})`);
    return;
  }

  // Progress POSTs only need x-s2s-key (the per-event /webhook/progress sink
  // is shared-secret-gated, not per-run-bound). The FINAL callback POST is
  // different — it needs x-session-token too (see callbackHeaders below).
  const sharedHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
  };
  // Final-callback POST adds the per-run HMAC bearer so /webhook/result and
  // /sessions/:id/result accept it. Mirrors legacy claw sendCallback's headers
  // (xyne-claw/src/routes/run.ts:1924). Without this the receiver logs
  // "[result-token] rejecting result (session=...): malformed → 401".
  const callbackHeaders: Record<string, string> = {
    ...sharedHeaders,
    ...(sessionToken ? { "x-session-token": sessionToken } : {}),
  };
  const spacesProgress = isSpacesWebhookProgressUrl(progressUrl);
  // Conv-keyed fallback fields. Always present in legacy POSTs that claw used
  // to send (createProgressReporter ships them when progressMeta is set).
  // /webhook/progress depends on them to resolve session ctx via the conv-keyed
  // index. Read them from forwardBody and stamp onto every progress + callback
  // POST so downstream consumers behave exactly as they did before.
  const convFallback: Record<string, unknown> = {
    ...(conversationId !== undefined ? { conversationId } : {}),
    ...(agentSlug !== undefined ? { agentSlug } : {}),
  };

  // Serial dispatch via consumeAlreadyOpenStream's awaited handlers means
  // these POSTs land at progressUrl in the exact order claw emitted them.
  const postProgress = async (body: Record<string, unknown>): Promise<void> => {
    if (!progressUrl) return;
    try {
      await fetch(progressUrl, {
        method: "POST",
        headers: sharedHeaders,
        body: JSON.stringify({ ...convFallback, ...body }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      log.warn(
        `[run] proxy: progress POST failed (session=${sessionId}): ${errMsg(err)}`,
      );
    }
  };

  try {
    const result = await consumeAlreadyOpenStream(
      probeRes.body,
      {
        onInvocation: async (sid, toolInvocation) => {
          await postProgress({ sessionId: sid, toolInvocation });
        },
        onReasoning: async (sid, reasoningDelta) => {
          // Spaces sink doesn't consume reasoning deltas — skip to keep the SSE
          // reader moving instead of awaiting a no-op POST per chunk.
          if (spacesProgress) return;
          await postProgress({ sessionId: sid, reasoningDelta });
        },
        onTextDelta: async (sid, textDelta) => {
          if (spacesProgress) return;
          await postProgress({ sessionId: sid, textDelta });
        },
        onAttachment: async (sid, attachment) => {
          // /webhook/progress ignores per-chunk attachments — the final
          // /webhook/result callback carries the persisted ones via `attachments`.
          if (spacesProgress) return;
          await postProgress({ sessionId: sid, attachment });
        },
        onSandboxPreview: async (sid, payload) => {
          await postProgress({ sessionId: sid, ...payload });
        },
        onPlan: async (sid, todos) => {
          await postProgress({ sessionId: sid, kind: "plan", todos });
        },
        onPr: async (sid, pr) => {
          log.info(`[run] proxy: bridging kind:pr → progress session=${sid}`);
          await postProgress({ sessionId: sid, kind: "pr", pr });
        },
        onUiWidget: async (sid, widget) => {
          await postProgress({ sessionId: sid, kind: "ui-widget", widget });
        },
        onProgressLabel: async (sid, payload) => {
          await postProgress({ sessionId: sid, ...payload });
        },
        onDebug: async (sid, debugEvent) => {
          if (spacesProgress) return;
          await postProgress({ sessionId: sid, debugEvent });
        },
      },
      (expected, got) => {
        log.warn(`[run] proxy: bridge seq gap session=${sessionId}: expected ${expected}, got ${got}`);
      },
    );

    if (callbackUrl && result.result) {
      try {
        // POST the entire done payload verbatim — it IS the sendCallback body
        // claw built in legacy mode. Plus the conv-fallback stamp in case
        // sessionId-based lookup misses on the receiver. Don't filter to a
        // subset — /webhook/result reads userId, toolsUsed, tokenUsage,
        // latency, reasoning, provider, model, etc., and stripping any of
        // those breaks downstream consumers silently (Control Center finalize,
        // digital-twin suffix, etc.).
        await fetch(callbackUrl, {
          method: "POST",
          headers: callbackHeaders,
          body: JSON.stringify({
            ...convFallback,
            ...result.result,
            sessionId,
          }),
        });
      } catch (err) {
        log.warn(
          `[run] proxy: callback POST failed (session=${sessionId}): ${errMsg(err)}`,
        );
      }
    } else if (!result.result) {
      // No done frame arrived — claw's stream ended cleanly without one. Surface
      // a synthetic failed callback so the caller's run tracker doesn't sit in
      // "running" forever.
      if (callbackUrl && !isScheduledOrAutomationEvent(eventType)) {
        log.warn(`[run] proxy: bridge lost; run continues headless (session=${sessionId})`);
        armHeadlessFinalizeCheck({
          sessionId,
          sessionToken,
          callbackUrl,
          conversationId,
          agentSlug,
          eventType,
          fastMode: forwardBody["fastMode"] === true,
        });
        return;
      }
      const retried = await retryBrokenBridgeOnce({
        forwardBody,
        oldSessionId: sessionId,
        callbackUrl,
        reason: "bridge ended before done",
      });
      if (retried) return;
      await postBrokenSseTerminalCallback({
        callbackUrl,
        sessionId,
        sessionToken,
        conversationId,
        agentSlug,
        eventType,
        fastMode: forwardBody["fastMode"] === true,
        logPrefix: "bridge ended before done",
      });
    }
  } catch (err) {
    if (callbackUrl && !isScheduledOrAutomationEvent(eventType)) {
      log.warn(`[run] proxy: bridge lost; run continues headless (session=${sessionId})`);
      armHeadlessFinalizeCheck({
        sessionId,
        sessionToken,
        callbackUrl,
        conversationId,
        agentSlug,
        eventType,
        fastMode: forwardBody["fastMode"] === true,
      });
      return;
    }
    log.error(
      `[run] proxy: bridge failed (session=${sessionId}): ${errMsg(err)}`,
    );
    const retried = await retryBrokenBridgeOnce({
      forwardBody,
      oldSessionId: sessionId,
      callbackUrl,
      reason: "bridge failed before done",
    });
    if (retried) return;
    await postBrokenSseTerminalCallback({
      callbackUrl,
      sessionId,
      sessionToken,
      conversationId,
      agentSlug,
      eventType,
      fastMode: forwardBody["fastMode"] === true,
      logPrefix: "bridge failed before done",
    });
  }
}
