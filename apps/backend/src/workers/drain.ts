import { logger } from '@/utils/logger';

/**
 * Default bounded wait, per role, for in-flight jobs to finish on shutdown.
 * Kept well under a typical Kubernetes terminationGracePeriodSeconds so the
 * pod is never SIGKILLed mid-drain. Override with WORKER_DRAIN_TIMEOUT_MS.
 */
export const DEFAULT_DRAIN_MS = Number(process.env.WORKER_DRAIN_TIMEOUT_MS ?? 25_000);

const timeout = (ms: number): Promise<'timeout'> =>
  new Promise((resolve) => {
    const t = setTimeout(() => resolve('timeout'), ms);
    // Don't let the drain timer itself keep the event loop alive.
    t.unref();
  });

export type DrainOutcome = 'drained' | 'timeout' | 'error';

/**
 * Run one role's stop/close with a bounded wait.
 *
 * Why bounded: Bull v3 `queue.close()` waits for active jobs INDEFINITELY and
 * takes no timeout argument. If a single stuck job blocks close(), an unbounded
 * await would burn the whole termination grace period and the pod gets
 * SIGKILLed — which drops EVERY in-flight job across EVERY role. Racing close()
 * against a deadline degrades that to "this one role exceeded its budget"
 * (logged) while the rest of the fleet still drains cleanly.
 *
 * Never throws: a role that fails to stop must not abort the shutdown of the
 * roles after it.
 */
export async function drainRole(
  name: string,
  stop: () => Promise<void>,
  timeoutMs: number = DEFAULT_DRAIN_MS,
): Promise<DrainOutcome> {
  const startedAt = Date.now();
  try {
    const result = await Promise.race([
      stop().then((): DrainOutcome => 'drained'),
      timeout(timeoutMs),
    ]);
    if (result === 'timeout') {
      logger.warn(`[shutdown] ${name} drain exceeded ${timeoutMs}ms — proceeding without it`);
      return 'timeout';
    }
    logger.info(`[shutdown] ${name} drained in ${Date.now() - startedAt}ms`);
    return 'drained';
  } catch (err) {
    logger.error(`[shutdown] ${name} stop() threw after ${Date.now() - startedAt}ms:`, err);
    return 'error';
  }
}
