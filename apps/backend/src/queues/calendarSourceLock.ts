/**
 * Per-source mutex for the calendar sync queues.
 *
 * Concurrency is safe across sources but not within one: both providers keep a
 * cursor (Google syncToken, Graph deltaLink) that a sync reads at the start and
 * writes back at the end, so two overlapping jobs for one source would leave a
 * cursor that skips events. Deterministic jobIds only stop a duplicate job being
 * enqueued — manual-sync and incremental-sync have different ids and can overlap.
 */

import {
  CALENDAR_SOURCE_LOCK_TTL_SECONDS,
  CALENDAR_SOURCE_LOCK_WAIT_MS,
} from '@/services/calendarSyncConfig';
import { acquireLock, releaseLock } from '@/utils/distributedLock';
import { logger } from '@/utils/logger';

export type CalendarProvider = 'google' | 'microsoft';

/** Thrown when a source is already syncing. Lets Bull retry with backoff. */
export class CalendarSourceBusyError extends Error {
  constructor(provider: CalendarProvider, sourceId: string) {
    super(`Calendar sync already in progress for ${provider} source ${sourceId}`);
    this.name = 'CalendarSourceBusyError';
  }
}

export function calendarSourceLockKey(provider: CalendarProvider, sourceId: string): string {
  return `lock:calendar-sync:${provider}:${sourceId}`;
}

/**
 * Run `fn` holding this source's lock. Throws {@link CalendarSourceBusyError}
 * when the source stays busy, so Bull retries rather than dropping the sync.
 * acquireLock fails open: if Redis is down we proceed unlocked.
 */
export async function withCalendarSourceLock<T>(
  provider: CalendarProvider,
  sourceId: string,
  fn: () => Promise<T>
): Promise<T> {
  const key = calendarSourceLockKey(provider, sourceId);
  const handle = await acquireLock(key, {
    ttlSeconds: CALENDAR_SOURCE_LOCK_TTL_SECONDS,
    waitTimeoutMs: CALENDAR_SOURCE_LOCK_WAIT_MS,
  });

  if (!handle) {
    logger.warn('[CALENDAR_SYNC][LOCK] Source busy, deferring to Bull retry', {
      provider,
      sourceId,
      waitedMs: CALENDAR_SOURCE_LOCK_WAIT_MS,
    });
    throw new CalendarSourceBusyError(provider, sourceId);
  }

  try {
    return await fn();
  } finally {
    await releaseLock(handle);
  }
}
