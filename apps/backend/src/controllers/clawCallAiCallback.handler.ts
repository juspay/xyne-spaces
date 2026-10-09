import type { Request, Response } from 'express';
import { logger } from '@/utils/logger';
import {
  isClawCallAiRunPending,
  storeClawCallAiRunOutcome,
} from '@/services/callAi/clawCallAiResultStore';

/**
 * Terminal result of a call AI Claw run, forwarded by claw-auth to the URL the
 * run was dispatched with (`/api/internal/call-ai/claw-callback/:runKey`).
 * Authenticated by validateS2SKey at the route. The waiter that dispatched the
 * run (possibly on another pod) picks the outcome up from Redis.
 */
export async function handleClawCallAiCallback(
  req: Request<{ runKey: string }>,
  res: Response,
): Promise<void> {
  const { runKey } = req.params;
  const payload = (req.body ?? {}) as Record<string, unknown>;
  const rawStatus = typeof payload['status'] === 'string' ? payload['status'] : '';
  const error = typeof payload['error'] === 'string' && payload['error'] ? payload['error'] : undefined;
  const result = typeof payload['result'] === 'string' ? payload['result'] : '';

  try {
    if (!(await isClawCallAiRunPending(runKey))) {
      // Timed out, cancelled, or already finished; nothing is waiting for it.
      logger.info('[CallAiClaw] callback for a run no longer pending — dropping', {
        run_key: runKey,
        status: rawStatus,
      });
      res.json({ success: true, persisted: false });
      return;
    }

    const status = rawStatus === 'completed' && !error ? 'completed' : rawStatus === 'cancelled' ? 'cancelled' : 'failed';
    await storeClawCallAiRunOutcome(runKey, {
      status,
      result,
      ...(error ? { error } : status === 'failed' && rawStatus ? { error: `claw status: ${rawStatus}` } : {}),
    });

    logger.info('[CallAiClaw] callback stored', {
      run_key: runKey,
      status,
      claw_status: rawStatus,
      result_length: result.length,
      ...(error ? { error } : {}),
    });
    res.json({ success: true, persisted: true });
  } catch (err) {
    logger.error('[CallAiClaw] callback handling failed', {
      run_key: runKey,
      error: err instanceof Error ? err.message : String(err),
    });
    // The waiter also polls Claw's run status, so a lost callback is recoverable.
    res.status(500).json({ success: false, error: 'Failed to store result' });
  }
}
