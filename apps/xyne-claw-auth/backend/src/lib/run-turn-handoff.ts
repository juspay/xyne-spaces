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

async function postInternalRunAction(sessionId: string, action: string, userId: string): Promise<boolean> {
  try {
    const res = await fetch(
      `${CONFIG.internalUrl}/claw/api/v1/internal/run/${encodeURIComponent(sessionId)}/${action}`,
      { method: "POST", headers: internalRunHeaders(userId) },
    );
    if (!res.ok) {
      log.warn(`[turn-handoff] ${action} rejected session=${sessionId} status=${res.status}`);
    }
    return res.ok;
  } catch (err) {
    log.warn(`[turn-handoff] ${action} failed session=${sessionId}: ${errMsg(err)}`);
    return false;
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
  const { conversationId, userId, onLabel } = args;
  if (!conversationId) return { handedOff: false, reason: "no_conversation" };

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
      .findRunningByConversation(conversationId)
      .catch(() => null);
    if (!remoteRun?.sessionId) return { handedOff: false, reason: "no_active_run" };

    onLabel?.(TURN_HANDOFF_LABEL);
    await postInternalRunAction(remoteRun.sessionId, "interrupt-with-reply", remoteRun.userId ?? userId);
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
