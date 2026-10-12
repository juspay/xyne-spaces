import { redisService } from '@/services/redisService';
import { logger } from '@/utils/logger';
import type { ClawCallAiRunOutcome } from './types';

/**
 * Hands a Claw run's result from the callback (any API pod) to the waiter (the
 * worker that dispatched it). The waiter registers a pending marker before
 * dispatch; the callback only stores results for runs that are still pending,
 * so a stray or late callback cannot plant data for an unknown run.
 */

const PENDING_PREFIX = 'call-ai:claw:pending:';
const RESULT_PREFIX = 'call-ai:claw:result:';
// Results only need to outlive the waiter's next poll; keep them briefly.
const RESULT_TTL_SECONDS = 60 * 60;

export async function markClawCallAiRunPending(runKey: string, ttlMs: number): Promise<void> {
  // Buffer past the run timeout so a callback racing the deadline still lands.
  const ttlSeconds = Math.ceil(ttlMs / 1000) + 5 * 60;
  await redisService.set(`${PENDING_PREFIX}${runKey}`, '1', ttlSeconds);
}

export async function isClawCallAiRunPending(runKey: string): Promise<boolean> {
  return (await redisService.get(`${PENDING_PREFIX}${runKey}`)) !== null;
}

export async function storeClawCallAiRunOutcome(
  runKey: string,
  outcome: ClawCallAiRunOutcome,
): Promise<void> {
  await redisService.set(`${RESULT_PREFIX}${runKey}`, JSON.stringify(outcome), RESULT_TTL_SECONDS);
}

export async function readClawCallAiRunOutcome(runKey: string): Promise<ClawCallAiRunOutcome | null> {
  const raw = await redisService.get(`${RESULT_PREFIX}${runKey}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ClawCallAiRunOutcome;
  } catch (error) {
    logger.warn('[CallAiClaw] unreadable stored run outcome', {
      runKey,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function clearClawCallAiRun(runKey: string): Promise<void> {
  await Promise.all([
    redisService.del(`${PENDING_PREFIX}${runKey}`),
    redisService.del(`${RESULT_PREFIX}${runKey}`),
  ]);
}
