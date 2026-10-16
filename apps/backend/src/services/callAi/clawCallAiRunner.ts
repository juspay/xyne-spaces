import { randomUUID } from 'crypto';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { cancelS2SClawRun, getS2SClawRunStatus } from '@/services/clawAgentService';
import {
  clawClient,
  resolveAgentSpacesAppId,
  resolveHeadlessIdentityContext,
} from '@/automations/services/claw-client';
import { CLAW_CALL_AI_SETTINGS } from './clawCallAiSettings';
import {
  clearClawCallAiRun,
  markClawCallAiRunPending,
  readClawCallAiRunOutcome,
} from './clawCallAiResultStore';
import type {
  CallAiTask,
  ClawCallAiFailureReason,
  ClawCallAiIdentity,
  ClawCallAiResult,
  ClawCallAiRunOutcome,
} from './types';

/** Everything `clawClient.runAgent` needs about who runs the agent and where. */
type ClawCallAiDispatchTarget = ClawCallAiIdentity & {
  spacesAppId: string;
  spacesWorkspaceId: string;
  spacesOrgId: string;
  spacesOrgMemberId: string;
};

/** Callback route; registered in app.ts. */
export const CLAW_CALL_AI_CALLBACK_PATH = '/api/internal/call-ai/claw-callback';

export function isClawCallAiEnabled(): boolean {
  return config.callAi.useClawAgent;
}

/**
 * The prompt travels in `context`, which Claw passes to the agent verbatim.
 * `task` is deliberately short and plain: claw-auth runs it through an
 * HTML-to-text pass that would strip `<...>` and collapse whitespace in
 * transcripts and Markdown templates.
 */
function buildRunPayload(task: CallAiTask): { task: string; context: string } {
  const sections = [`### Operation\n${task.operation}`];
  const systemPrompt = task.systemPrompt?.trim();
  if (systemPrompt) {
    sections.push(`### Instructions\n${systemPrompt}`);
  }
  sections.push(`### Input\n${task.userPrompt}`);

  return {
    task: `Run the call AI operation "${task.operation}" exactly as described in the Additional Context. Reply with only the requested output.`,
    context: sections.join('\n\n'),
  };
}

const sleep = (ms: number, abortSignal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (abortSignal?.aborted) {
      resolve();
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      abortSignal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    abortSignal?.addEventListener('abort', onAbort, { once: true });
  });

function toOutcome(status: string, result: unknown, error: unknown): ClawCallAiRunOutcome | null {
  if (status !== 'completed' && status !== 'failed' && status !== 'cancelled') return null;
  return {
    status,
    result: typeof result === 'string' ? result : '',
    ...(typeof error === 'string' && error ? { error } : {}),
  };
}

async function fetchRunOutcome(
  sessionId: string,
  userId: string,
  logCallId: string,
  operation: string,
): Promise<ClawCallAiRunOutcome | null> {
  try {
    const run = await getS2SClawRunStatus(sessionId, userId);
    return run ? toOutcome(run.status, run.result, run.error) : null;
  } catch (error) {
    logger.warn(`[${logCallId}] ${operation}_claw_status_check_failed`, {
      session_id: sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Wait for one run to finish. Resolves on the callback (via Redis) or a status
 * poll, whichever reports first; cancels the run on timeout or abort.
 */
type ClawCallAiOutcomeSource = 'callback' | 'status_poll';

async function waitForRun(
  sessionId: string,
  identity: ClawCallAiIdentity,
  task: CallAiTask,
  logCallId: string,
): Promise<
  | (ClawCallAiRunOutcome & { source: ClawCallAiOutcomeSource })
  | { status: 'timeout' }
  | { status: 'aborted' }
> {
  const waitStart = Date.now();
  const deadline = waitStart + CLAW_CALL_AI_SETTINGS.runTimeoutMs;
  let nextStatusPollAt = Date.now() + CLAW_CALL_AI_SETTINGS.statusPollIntervalMs;

  while (Date.now() < deadline) {
    if (task.abortSignal?.aborted) {
      const cancelled = await cancelS2SClawRun(sessionId, identity.userId);
      logger.info(`[${logCallId}] ${task.operation}_claw_run_aborted`, {
        session_id: sessionId,
        elapsed_ms: Date.now() - waitStart,
        cancelled: cancelled.success,
      });
      return { status: 'aborted' };
    }

    const fromCallback = await readClawCallAiRunOutcome(sessionId);
    if (fromCallback) {
      if (fromCallback.status !== 'completed') return { ...fromCallback, source: 'callback' };
      // claw-auth rewrites @mentions in the forwarded text; the stored run keeps
      // the agent's own output, so prefer it once it has been finalized.
      const stored = await fetchRunOutcome(sessionId, identity.userId, logCallId, task.operation);
      const outcome = stored?.status === 'completed' && stored.result.trim() ? stored : fromCallback;
      return { ...outcome, source: 'callback' };
    }

    if (Date.now() >= nextStatusPollAt) {
      nextStatusPollAt = Date.now() + CLAW_CALL_AI_SETTINGS.statusPollIntervalMs;
      const polled = await fetchRunOutcome(sessionId, identity.userId, logCallId, task.operation);
      if (polled) {
        // Reaching a result here means the callback never arrived.
        logger.info(`[${logCallId}] ${task.operation}_claw_result_from_status_poll`, {
          session_id: sessionId,
          status: polled.status,
          elapsed_ms: Date.now() - waitStart,
        });
        return { ...polled, source: 'status_poll' };
      }
      logger.info(`[${logCallId}] ${task.operation}_claw_still_running`, {
        session_id: sessionId,
        elapsed_ms: Date.now() - waitStart,
      });
    }

    await sleep(CLAW_CALL_AI_SETTINGS.pollIntervalMs, task.abortSignal);
  }

  const cancelled = await cancelS2SClawRun(sessionId, identity.userId);
  logger.warn(`[${logCallId}] ${task.operation}_claw_run_timed_out`, {
    session_id: sessionId,
    timeout_ms: CLAW_CALL_AI_SETTINGS.runTimeoutMs,
    cancelled: cancelled.success,
  });
  return { status: 'timeout' };
}

/** Dispatch one run and wait for it. Never throws. */
async function runOnce(
  task: CallAiTask,
  target: ClawCallAiDispatchTarget,
  attempt: number,
  logCallId: string,
): Promise<ClawCallAiResult> {
  const sessionId = randomUUID();
  const { agentSlug } = CLAW_CALL_AI_SETTINGS;
  const { task: runTask, context } = buildRunPayload(task);
  const callbackUrl = `${config.xyneClaw.callbackUrl.replace(/\/$/, '')}${CLAW_CALL_AI_CALLBACK_PATH}/${encodeURIComponent(sessionId)}`;
  const attemptStart = Date.now();

  try {
    await markClawCallAiRunPending(sessionId, CLAW_CALL_AI_SETTINGS.runTimeoutMs);
    await clawClient.runAgent({
      sessionId,
      spacesAppId: target.spacesAppId,
      agentSlug,
      task: runTask,
      context,
      userId: target.userId,
      spacesWorkspaceId: target.spacesWorkspaceId,
      spacesOrgId: target.spacesOrgId,
      spacesOrgMemberId: target.spacesOrgMemberId,
      // No conversationId: each run is standalone, which avoids claw-auth's
      // per-conversation slot (409/queueing) and chat-history writes.
      callbackUrl,
    });
  } catch (error) {
    await clearClawCallAiRun(sessionId).catch(() => undefined);
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[${logCallId}] ${task.operation}_claw_dispatch_failed`, {
      attempt,
      agent_slug: agentSlug,
      workspace_id: target.workspaceId,
      error: message,
    });
    return { ok: false, reason: 'dispatch_failed', error: message };
  }

  logger.info(`[${logCallId}] ${task.operation}_claw_dispatched`, {
    attempt,
    session_id: sessionId,
    agent_slug: agentSlug,
    user_id: target.userId,
    workspace_id: target.workspaceId,
    spaces_app_id: target.spacesAppId,
    input_length: task.userPrompt.length,
    context_length: context.length,
    callback_url: callbackUrl,
  });

  try {
    const outcome = await waitForRun(sessionId, target, task, logCallId);
    const duration_ms = Date.now() - attemptStart;

    if (outcome.status === 'aborted') return { ok: false, reason: 'cancelled' };
    if (outcome.status === 'timeout') return { ok: false, reason: 'timeout' };
    if (outcome.status !== 'completed') {
      logger.warn(`[${logCallId}] ${task.operation}_claw_run_failed`, {
        attempt,
        session_id: sessionId,
        status: outcome.status,
        source: outcome.source,
        error: outcome.error,
        duration_ms,
      });
      return { ok: false, reason: 'run_failed', ...(outcome.error ? { error: outcome.error } : {}) };
    }

    const content = outcome.result.trim();
    if (!content) {
      logger.warn(`[${logCallId}] ${task.operation}_claw_empty_result`, {
        attempt,
        session_id: sessionId,
        source: outcome.source,
        duration_ms,
      });
      return { ok: false, reason: 'empty_content' };
    }

    logger.info(`[${logCallId}] ${task.operation}_claw_success`, {
      attempt,
      session_id: sessionId,
      source: outcome.source,
      result_length: content.length,
      duration_ms,
    });
    return { ok: true, content, sessionId };
  } finally {
    await clearClawCallAiRun(sessionId).catch(() => undefined);
  }
}

const TERMINAL_REASONS: ReadonlySet<ClawCallAiFailureReason> = new Set([
  'cancelled',
  'empty_content',
]);

/**
 * Run a call AI task on a Claw agent as `identity`: dispatch, wait for the
 * result, and retry transient failures. Never throws.
 */
export async function runCallAiTaskOnClaw(
  task: CallAiTask,
  identity: ClawCallAiIdentity,
): Promise<ClawCallAiResult> {
  const logCallId = task.callId || 'unknown';
  if (task.abortSignal?.aborted) return { ok: false, reason: 'cancelled' };

  // Resolved once: an agent that is not installed in the workspace will not be
  // on a retry either, so this fails straight to the legacy engine.
  let target: ClawCallAiDispatchTarget;
  try {
    const [spacesAppId, headless] = await Promise.all([
      resolveAgentSpacesAppId(CLAW_CALL_AI_SETTINGS.agentSlug, identity.workspaceId),
      resolveHeadlessIdentityContext(identity.userId, identity.workspaceId),
    ]);
    target = { ...identity, spacesAppId, ...headless };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`[${logCallId}] ${task.operation}_claw_agent_unavailable`, {
      agent_slug: CLAW_CALL_AI_SETTINGS.agentSlug,
      workspace_id: identity.workspaceId,
      error: message,
    });
    return { ok: false, reason: 'dispatch_failed', error: message };
  }

  const maxAttempts = CLAW_CALL_AI_SETTINGS.maxAttempts;
  let last: ClawCallAiResult = { ok: false, reason: 'run_failed' };
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    last = await runOnce(task, target, attempt, logCallId);
    if (last.ok || TERMINAL_REASONS.has(last.reason)) return last;
    if (attempt < maxAttempts) {
      logger.warn(`[${logCallId}] ${task.operation}_claw_retry_scheduled`, {
        attempt,
        next_attempt: attempt + 1,
        reason: last.reason,
        error: last.error,
        delay_ms: CLAW_CALL_AI_SETTINGS.retryDelayMs,
      });
      await sleep(CLAW_CALL_AI_SETTINGS.retryDelayMs, task.abortSignal);
    }
    if (task.abortSignal?.aborted) return { ok: false, reason: 'cancelled' };
  }

  logger.error(`[${logCallId}] ${task.operation}_claw_failed_after_retries`, {
    attempts: maxAttempts,
    reason: last.ok ? undefined : last.reason,
  });
  return last;
}
