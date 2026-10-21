import { logger } from '@/utils/logger';
import { resolveClawCallAiIdentity } from './clawCallAiIdentity';
import { isClawCallAiEnabled, runCallAiTaskOnClaw } from './clawCallAiRunner';
import type { CallAiTask, ClawCallAiFailureReason, ClawCallAiIdentity } from './types';

export interface CallAiResultAdapter<T> {
  ok: (content: string) => T | Promise<T>;
  fail: (reason: ClawCallAiFailureReason, error?: string) => T;
}

/**
 * The single switch between the two call AI engines. Without
 * CALL_AI_USE_CLAW_AGENT this just runs `legacy`. With it, tasks on a real call
 * run on the Claw agent as the call's creator and the result is mapped into the
 * caller's own result shape; tasks with no call behind them (summary templates,
 * desk recordings) stay on `legacy`. If the Claw run fails the task falls back
 * to `legacy`, except for a cancelled request.
 */
export async function runCallAiTask<T>(
  task: CallAiTask,
  adapt: CallAiResultAdapter<T>,
  legacy: () => Promise<T>,
): Promise<T> {
  if (!isClawCallAiEnabled()) {
    return legacy();
  }

  const logCallId = task.callId || 'unknown';
  let identity: ClawCallAiIdentity | null = null;
  try {
    identity = await resolveClawCallAiIdentity(task);
  } catch (error) {
    logger.warn(`[${logCallId}] ${task.operation}_claw_identity_failed`, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  if (!identity) {
    logger.info(`[${logCallId}] ${task.operation}_engine_legacy`, { reason: 'no_call_creator' });
    return legacy();
  }

  const start = Date.now();
  logger.info(`[${logCallId}] ${task.operation}_engine_claw`, {
    user_id: identity.userId,
    workspace_id: identity.workspaceId,
    has_system_prompt: Boolean(task.systemPrompt?.trim()),
    input_length: task.userPrompt.length,
  });

  const result = await runCallAiTaskOnClaw(task, identity);
  if (result.ok) {
    return adapt.ok(result.content);
  }
  if (result.reason === 'cancelled') {
    logger.info(`[${logCallId}] ${task.operation}_claw_cancelled`, { total_ms: Date.now() - start });
    return adapt.fail(result.reason, result.error);
  }

  logger.warn(`[${logCallId}] ${task.operation}_claw_falling_back_to_legacy`, {
    reason: result.reason,
    error: result.error,
    total_ms: Date.now() - start,
  });
  return legacy();
}
