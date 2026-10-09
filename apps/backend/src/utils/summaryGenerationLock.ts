import { acquireLock, type LockHandle } from '@/utils/distributedLock';

// Only reached when a run dies without releasing the lock; a normal run releases it as
// soon as it settles. Long enough to outlast a slow model, short enough that a wedged
// run doesn't block the retry for long.
const SUMMARY_GENERATION_LOCK_TTL_SECONDS = 15 * 60;

/**
 * One lock per call, shared by every manual detailed-summary entry point (the admin
 * panel's regenerate, the recording's generate-summary and the call's
 * generate-detailed-summary), so two runs can't overlap and overwrite each other's
 * `detailedSummaryStatus`. Returns null while another run holds it.
 */
export function acquireSummaryGenerationLock(callExternalId: string): Promise<LockHandle | null> {
  return acquireLock(`lock:summary-generation:${callExternalId}`, {
    ttlSeconds: SUMMARY_GENERATION_LOCK_TTL_SECONDS,
  });
}
