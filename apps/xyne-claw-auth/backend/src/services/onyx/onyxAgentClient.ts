/**
 * onyx-agent-client — S2S wrapper on the prod ask-ai agent run path.
 *
 * Fires ONE claw run per benchmark question through the SAME /internal/run
 * endpoint the scheduled-jobs worker uses — the flow that Ask AI v2 drives
 * via /run/stream. Nothing bespoke: the bench agent executes the genuine
 * spaces-search tool, only its parent-fire + result-handoff differ in win.
 *
 * Result handoff = claw posts its terminal callback payload to
 * /claw/api/v1/onyx-evals-agent/callback — stashed in Redis by that route,
 * hashed by `onyx-callback:<runId>:<questionId>`; the worker polls to capture.
 * (Cross-pod safe because BOTH pods share Redis; the run stays auditable in
 * the control-center because we do NOT opt out of AgentRun persistence.)
 */
import { CONFIG } from "../../config.js";
import { redisService } from "../../redis.js";

import { createLogger } from "../../logger.js";
const log = createLogger("onyx-agent-client");

const RUN_FIRE_TIMEOUT_MS = 30_000;
const RESULT_STASH_TTL_S = 3_600; // 1h — plenty beyond ONYX_EVAL_CLAW_TIMEOUT_MS

export interface OnyxAgentRunOutcome {
  sessionId: string;
  status: "completed" | "failed" | "cancelled";
  answerText: string | null;
  toolInvocations: unknown[] | null;
  rawPayload: unknown;
  error: string | null;
}

export interface OnyxRunRef {
  runId: string;
  questionId: string;
  orgId: string;
}

function stashKey({ runId, questionId }: Pick<OnyxRunRef, "runId" | "questionId">): string {
  return `onyx-callback:${runId}:${questionId}`;
}

/** The per-question conversation id identifies this exact fire uniquely in BOTH
 *  claw's session store AND the callback stash — a retry of the same questionId
 *  inside the same run doesn't ambiguate (caller's fork has to cut it out). */
function conversationIdFor({ runId, questionId, epoch }: OnyxRunRef & { epoch: number }): string {
  return `onyx_${runId}_${questionId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64)}_${epoch}`;
}

/**
 * Fire the bench agent on one question. Returns null when the dispatch call
 * itself fails (claw unreachable / rejected) — caller records an error row.
 * Mirrors the dispatches in scheduled-jobs-worker line-by-line: org/user/engine
 * come from env: agentSlug from ONYX_EVAL_AGENT_SLUG, userId from the bench
 * agent row's spacesAppUserId (app-token app mode) and the org of the "onyx"
 * workspace (the run's claw-admin org NEVER enters the dispatch).
 */
export interface OnyxFireFailure {
  /** Why claw (= proxy of claw) rejected this fire — HTTP status + body or the raw error. */
  reason: string;
}
export type OnyxFireResult = { ok: true; sessionId: string } | { ok: false; failure: OnyxFireFailure };

export async function fireOnyxQuestionRun(params: {
  orgId: string;
  agentSlug: string;
  userId: string;
  callbackUrl: string;
  questionText: string;
  ref: OnyxRunRef;
  epoch: number;
  model?: string | undefined;
  config?: Record<string, unknown> | undefined;
}): Promise<OnyxFireResult> {
  const conversationId = conversationIdFor({ ...params.ref, epoch: params.epoch });
  const idempotencyKey = conversationId;

  const payload: Record<string, unknown> = {
    userId: params.userId,
    task: params.questionText,
    agentSlug: params.agentSlug,
    orgId: params.orgId,
    channelId: `onyx-bench-${params.orgId}`,
    conversationId,
    traceId: conversationId,
    callbackUrl: params.callbackUrl,
    // Noise-free: no schedule-shaped context, no playwright instructions — the
    // bench acts like a prod user asked the ask-ai agent the bare question.
    context: null,
    detached: true,
    triggerSource: "automation",
    eventType: "automation",
    idempotencyKey,
    // Leave AgentRun persistence ON: the Control Center trail is part of the
    // audit — the run tags "automation" so it doesn't misleadingly masquerade
    // as a real user session.
    __persistedByCaller: false,
    ...(params.model ? { provider: params.model } : {}),
    // Dispatch-authoritative narrowing (see worker): if the bench needs an
    // exact-tool subset, the CONFIG field — supplied — wins over whatever the
    // ask-ai row carries. Supplied = enforced.
    ...(params.config ? { agentConfig: params.config } : {}),
  };

  try {
    const res = await fetch(`${CONFIG.internalUrl}/claw/api/v1/internal/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(RUN_FIRE_TIMEOUT_MS),
    });
    const body = (await res.json()) as { success?: boolean; sessionId?: string; error?: unknown };
    if (!res.ok || body.success !== true || typeof body.sessionId !== "string") {
      const reason = `HTTP ${res.status} body=${typeof body?.error === "string" ? body.error : JSON.stringify(body).slice(0, 300)}`;
      log.warn(`[onyx-agent-client] /internal/run → ${reason} (slug=${params.agentSlug} org=${params.orgId} user=${params.userId})`);
      return { ok: false, failure: { reason } };
    }
    return { ok: true, sessionId: body.sessionId };
  } catch (err) {
    const reason = `exception: ${err instanceof Error ? err.message : String(err)}`;
    log.warn(`[onyx-agent-client] /internal/run ${reason} (slug=${params.agentSlug})`);
    return { ok: false, failure: { reason } };
  }
}

/**
 * Stash written by the callback route, read by the awaiting worker —
 * the worker polls: expected path is ≤ the agent latency + a few seconds.
 */
export async function stashOnyxCompletion(ref: Pick<OnyxRunRef, "runId" | "questionId">, outcome: OnyxAgentRunOutcome): Promise<void> {
  const key = stashKey(ref);
  await redisService.getConnection().set(key, JSON.stringify(outcome), "EX", RESULT_STASH_TTL_S);
  log.info(`[onyx-agent-client] completion stashed for ${key} (status=${outcome.status})`);
}

/** Blocking await with a deadline — the question fails if the agent run
 *  outlives the harness's per-question budget. */
export async function awaitOnyxCompletion(
  ref: Pick<OnyxRunRef, "runId" | "questionId">,
  timeoutMs: number,
  pollMs = 1_000,
): Promise<OnyxAgentRunOutcome | null> {
  const deadline = Date.now() + timeoutMs;
  const key = stashKey(ref);
  while (Date.now() < deadline) {
    const raw = await redisService.getConnection().get(key);
    if (raw) {
      try { return JSON.parse(raw) as OnyxAgentRunOutcome; }
      catch { return null; }
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return null;
}
