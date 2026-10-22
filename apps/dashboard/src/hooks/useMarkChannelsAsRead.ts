import { useCallback } from 'react';
import { toast } from 'sonner';
import { apiInstance } from '../services/clients/apiClient';
import { logger, Event } from '../utils/logger';

const FAILURE_MESSAGE = "Couldn't mark everything as read. Please try again.";

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
 * Resolves `true` when the server accepted the whole set, `false` (after a toast) otherwise.
 */
export function useMarkChannelsAsRead(): (channelIds: readonly string[]) => Promise<boolean> {
  return useCallback(async (channelIds: readonly string[]): Promise<boolean> => {
    const uniqueIds = [...new Set(channelIds)];
    if (uniqueIds.length === 0) return true;

    try {
      await apiInstance.post('/channels/mark-read', { channelIds: uniqueIds });
      return true;
    } catch (error) {
      logger.error(Event.FRONTEND_ERROR, {
        type: 'mark_channels_as_read_failed',
        channelCount: uniqueIds.length,
        error: error instanceof Error ? error.message : String(error),
      });
      toast.error(FAILURE_MESSAGE);
      return false;
    }
  }, []);
}
