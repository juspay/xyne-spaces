import { CONFIG } from "../config.js";
import { createLogger } from "../logger.js";
import { agentRunRepository } from "../repositories/index.js";
import { localHarnessRepository } from "../repositories/localHarnessRepository.js";
import { relayResult, requestLocalHarnessInterrupt, TURN_HANDOFF_SUMMARY_FALLBACK } from "./local-harness.js";

const log = createLogger("run-turn-handoff");

export const TURN_HANDOFF_LABEL = "Wrapping up the previous reply first…";
export { TURN_HANDOFF_SUMMARY_FALLBACK };

const HANDOFF_POLL_MS = 500;
const HANDOFF_TIMEOUT_MS = 30_000;

const TURN_CONTROL_COMMAND_RE = /(?:^|\s)\/(?:stop|cancel|clear)\s*$/i;

export function isTurnControlCommand(task: string): boolean {
  const trimmed = task.trim();
  return TURN_CONTROL_COMMAND_RE.test(trimmed) || /^\/(?:stop|cancel|clear)\b/i.test(trimmed);
}

const LIVE_HARNESS_STATUSES = new Set(["claimed", "running"]);

export interface TurnHandoffResult {
  handedOff: boolean;
  reason: string;
}

export interface AwaitTurnHandoffArgs {
  conversationId: string;
  agentSlug: string;
  userId: string;
  /**
   * The session id of the turn being started. REQUIRED, and deliberately not
   * optional: callers write their own AgentRun row at status "running" before
   * they get here, so without it the remote lookup below selects the caller's
   * own run. See findRunningByConversation in agentRunRepository.ts.
   */
  currentSessionId: string;
  onLabel?: (label: string) => void;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function internalRunHeaders(userId: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
    "x-user-id": userId,
  };
}

interface RunActionOutcome {
  ok: boolean;
  /**
   * xyne-claw's own verdict on the session: "interrupt_requested" when it is
   * live on this pod, "forwarded" when another pod owns it, "not_running" when
   * no pod does. `undefined` when the call failed or the body was unreadable —
   * treated as "might still be live", never as proof of death.
   */
  status?: string;
}

async function postInternalRunAction(
  sessionId: string,
  action: string,
  userId: string,
): Promise<RunActionOutcome> {
  try {
    const res = await fetch(
      `${CONFIG.internalUrl}/claw/api/v1/internal/run/${encodeURIComponent(sessionId)}/${action}`,
      { method: "POST", headers: internalRunHeaders(userId) },
    );
    if (!res.ok) {
      log.warn(`[turn-handoff] ${action} rejected session=${sessionId} status=${res.status}`);
      return { ok: false };
    }
    const body = (await res.json().catch(() => null)) as { status?: unknown } | null;
    const status = typeof body?.status === "string" ? body.status : undefined;
    return { ok: true, ...(status ? { status } : {}) };
  } catch (err) {
    log.warn(`[turn-handoff] ${action} failed session=${sessionId}: ${errMsg(err)}`);
    return { ok: false };
  }
}

async function waitForHarnessRun(runId: string): Promise<boolean> {
  const deadline = Date.now() + HANDOFF_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(HANDOFF_POLL_MS);
    const row = await localHarnessRepository.findById(runId).catch(() => null);
    if (!row || !LIVE_HARNESS_STATUSES.has(row.status)) return true;
  }
  return false;
}

async function waitForRemoteRun(sessionId: string): Promise<boolean> {
  const deadline = Date.now() + HANDOFF_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(HANDOFF_POLL_MS);
    const row = await agentRunRepository.findBySessionId(sessionId).catch(() => null);
    if (!row || row.status !== "running") return true;
  }
  return false;
}

export async function awaitTurnHandoff(args: AwaitTurnHandoffArgs): Promise<TurnHandoffResult> {
  const { conversationId, userId, currentSessionId, onLabel } = args;
  if (!conversationId) return { handedOff: false, reason: "no_conversation" };
  if (!currentSessionId) {
    // Types make this unreachable from TypeScript. Kept as a loud runtime guard
    // because passing nothing here is not a degraded handoff, it is a 30s stall
    // on every turn of the calling surface.
    log.error(
      `[turn-handoff] called without currentSessionId conv=${conversationId} — the caller's own run row can shadow the live one`,
    );
  }

  try {
    const harnessRun = await localHarnessRepository
      .findActiveByConversation(conversationId)
      .catch(() => null);

    if (harnessRun) {
      onLabel?.(TURN_HANDOFF_LABEL);
      await requestLocalHarnessInterrupt(harnessRun.id);
      log.info(`[turn-handoff] interrupt requested harness run=${harnessRun.id} conv=${conversationId}`);
      const settled = await waitForHarnessRun(harnessRun.id);
      if (settled) return { handedOff: true, reason: "local_harness_wrapped_up" };

      log.warn(`[turn-handoff] harness run=${harnessRun.id} did not wrap up in time — cancelling`);
      await localHarnessRepository.cancelRun(harnessRun.id).catch(() => false);
      await relayResult(harnessRun, {
        status: "done",
        text: TURN_HANDOFF_SUMMARY_FALLBACK,
        interrupted: true,
      }).catch(() => undefined);
      return { handedOff: true, reason: "local_harness_timeout" };
    }

    const remoteRun = await agentRunRepository
      .findRunningByConversation(conversationId, currentSessionId)
      .catch(() => null);
    if (!remoteRun?.sessionId) return { handedOff: false, reason: "no_active_run" };

    const outcome = await postInternalRunAction(
      remoteRun.sessionId,
      "interrupt-with-reply",
      remoteRun.userId ?? userId,
    );
    // xyne-claw is authoritative on whether a session is live; the row is not.
    // A run whose pod died stays at status "running" forever — finalizeOrphanedRun
    // has no sweeper, it only fires from the /stop handler — and polling such a
    // row burns the whole HANDOFF_TIMEOUT_MS to learn nothing. Excluding our own
    // session (above) stopped us from self-shadowing; this stops a stale row from
    // reintroducing the same stall.
    if (outcome.status === "not_running") {
      log.info(
        `[turn-handoff] session=${remoteRun.sessionId} is not running on xyne-claw (stale run row) conv=${conversationId} — dispatching immediately`,
      );
      return { handedOff: false, reason: "stale_run_row" };
    }

    onLabel?.(TURN_HANDOFF_LABEL);
    log.info(`[turn-handoff] interrupt-with-reply sent session=${remoteRun.sessionId} conv=${conversationId}`);
    const settled = await waitForRemoteRun(remoteRun.sessionId);
    if (settled) return { handedOff: true, reason: "remote_wrapped_up" };

    log.warn(`[turn-handoff] session=${remoteRun.sessionId} did not wrap up in time — cancelling`);
    await postInternalRunAction(remoteRun.sessionId, "cancel", remoteRun.userId ?? userId);
    return { handedOff: true, reason: "remote_timeout" };
  } catch (err) {
    log.warn(`[turn-handoff] failed conv=${conversationId}: ${errMsg(err)}`);
    return { handedOff: false, reason: "error" };
  }
}
