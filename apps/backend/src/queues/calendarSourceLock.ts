/**
 * Per-source mutex for the calendar sync queues.
 *
 * The Google and Microsoft sync queues drain CALENDAR_SYNC_QUEUE_CONCURRENCY
 * jobs at a time. That is safe across sources — each job opens its own
 * AsyncLocalStorage tenant scope via runWithContext — but NOT within a single
 * source, because both providers keep a server-side cursor (Google syncToken,
 * Graph deltaLink) that a sync reads at the start and writes back at the end.
 *
 * Two overlapping jobs for one source would interleave that read/write and the
 * loser would persist a cursor that skips whatever the winner already consumed,
 * losing those events until the next full resync. Bull's deterministic jobIds
 * stop a duplicate job being ENQUEUED, but they do not stop a manual sync and an
 * incremental sync — different job names, different ids — running side by side
 * once concurrency is above 1.
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
 * when the source stays busy for the whole wait window, so the job is retried
 * by Bull rather than silently dropped — the pending changes are still on the
 * provider and the next attempt picks them up from the same cursor.
 *
 * Note acquireLock fails OPEN: if Redis is unreachable it hands back a handle
 * and we proceed unlocked, matching how the rest of the codebase degrades.
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
