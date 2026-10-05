/**
 * Global mutex for the calendar sync queues: exactly one calendar sync job runs
 * at a time, across the Google and Microsoft queues and across every worker
 * replica. A job finishes completely before the next one starts.
 *
 * Each queue already runs one job at a time per process, but the two queues are
 * independent and the worker scales to several replicas, so without this lock
 * several jobs could still run side by side.
 */

import {
  CALENDAR_SYNC_LOCK_TTL_SECONDS,
  CALENDAR_SYNC_LOCK_WAIT_MS,
} from '@/services/calendarSyncConfig';
import { acquireLock, releaseLock } from '@/utils/distributedLock';
import { logger } from '@/utils/logger';

export type CalendarProvider = 'google' | 'microsoft';

const CALENDAR_SYNC_LOCK_KEY = 'lock:calendar-sync:global';

/** Thrown when another calendar sync held the lock for the whole wait. Lets Bull retry with backoff. */
export class CalendarSyncBusyError extends Error {
  constructor(provider: CalendarProvider, sourceId: string) {
    super(`Another calendar sync is still running; deferring ${provider} source ${sourceId}`);
    this.name = 'CalendarSyncBusyError';
  }
}

/**
 * Run `fn` holding the global calendar sync lock, waiting for any running sync
 * to finish first. Throws {@link CalendarSyncBusyError} if the lock stays held
 * past the wait, so Bull retries rather than dropping the sync.
 * acquireLock fails open: if Redis is down we proceed unlocked.
 */
export async function withCalendarSyncLock<T>(
  provider: CalendarProvider,
  sourceId: string,
  fn: () => Promise<T>
): Promise<T> {
  const handle = await acquireLock(CALENDAR_SYNC_LOCK_KEY, {
    ttlSeconds: CALENDAR_SYNC_LOCK_TTL_SECONDS,
    waitTimeoutMs: CALENDAR_SYNC_LOCK_WAIT_MS,
  });

  if (!handle) {
    logger.warn('[CALENDAR_SYNC][LOCK] Another sync still running, deferring to Bull retry', {
      provider,
      sourceId,
      waitedMs: CALENDAR_SYNC_LOCK_WAIT_MS,
    });
    throw new CalendarSyncBusyError(provider, sourceId);
  }

  try {
    return await fn();
  } finally {
    await releaseLock(handle);
  }
}
