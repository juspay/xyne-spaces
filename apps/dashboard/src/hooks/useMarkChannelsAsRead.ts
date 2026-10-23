import { useCallback } from 'react';
import { toast } from 'sonner';
import { MARK_READ_REQUEST_MAX_CHANNELS } from '@xyne/shared';
import { apiInstance } from '../services/clients/apiClient';
import { logger, Event } from '../utils/logger';

const FAILURE_MESSAGE = "Couldn't mark everything as read. Please try again.";
const PARTIAL_FAILURE_MESSAGE = "Some channels couldn't be marked as read. Please try again.";

/**
 * Marks a set of channels as read.
 *
 * Goes to the server over HTTP rather than through a Zero mutator. Zero replays a mutator
 * optimistically on the main thread before sending it, so marking a section read walked its
 * channels one at a time doing several reads each — measured at ~640ms of blocking for a
 * 60-channel section, which froze the window on click. Over HTTP the client does no work at
 * all: the server updates the rows and Zero replication clears the sidebar when they arrive.
 *
 * The trade is that badges no longer clear instantly — they clear a round-trip later. That
 * is the same bargain the bulk ticket auto-assign sweep makes (see DeskSettings
 * AssignmentTab), and for a bulk action it beats a frozen window.
 *
 * The single-channel path still uses the Zero mutator, where one channel's work is small
 * enough to be worth the instant optimistic clear.
 *
 * A set larger than the server accepts in one body is split into successive requests rather
 * than refused, so no group is ever too big to mark read. Requests go one at a time: the
 * overflow case is already unusual, and a burst of parallel bulk writes for one user buys
 * nothing. In practice a single request covers any real sidebar group and the loop runs once.
 *
 * Resolves `true` when every batch was accepted, `false` (after a toast) otherwise. A
 * partial failure still leaves the successful batches marked read — it reports rather than
 * rolls back, because re-running is harmless (marking a read channel read is a no-op).
 */
export function useMarkChannelsAsRead(): (channelIds: readonly string[]) => Promise<boolean> {
  return useCallback(async (channelIds: readonly string[]): Promise<boolean> => {
    const uniqueIds = [...new Set(channelIds)];
    if (uniqueIds.length === 0) return true;

    const batches: string[][] = [];
    for (let i = 0; i < uniqueIds.length; i += MARK_READ_REQUEST_MAX_CHANNELS) {
      batches.push(uniqueIds.slice(i, i + MARK_READ_REQUEST_MAX_CHANNELS));
    }

    let failed = 0;
    for (const batch of batches) {
      try {
        await apiInstance.post('/channels/mark-read', { channelIds: batch });
      } catch (error) {
        failed += 1;
        logger.error(Event.FRONTEND_ERROR, {
          type: 'mark_channels_as_read_failed',
          channelCount: batch.length,
          batchIndex: batches.indexOf(batch),
          batchCount: batches.length,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (failed === 0) return true;
    toast.error(failed === batches.length ? FAILURE_MESSAGE : PARTIAL_FAILURE_MESSAGE);
    return false;
  }, []);
}
