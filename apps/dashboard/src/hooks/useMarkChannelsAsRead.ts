import { useCallback } from 'react';
import { toast } from 'sonner';
import { MARK_CHANNELS_VIEWED_MAX_BATCH } from '@xyne/shared';
import { useZero } from './useZero';
import { mutators } from '../zero/mutators';
import { chunk } from '../components/Chat/ChatDirectory/ChatDirectory.utils';

const FAILURE_MESSAGE = "Couldn't mark everything as read. Please try again.";

/**
 * Marks a set of channels as read with the bulk `channel.markChannelsAsViewed`
 * mutator — one mutation per chunk of channels instead of one per channel, so a
 * big section stays well under the per-user mutation rate limit and clears
 * atomically per chunk.
 *
 * Zero applies each chunk optimistically, so the sidebar clears immediately. The
 * returned promise resolves once the server has answered: `true` if every chunk
 * succeeded, `false` (after a toast) if any chunk failed and was rolled back.
 */
export function useMarkChannelsAsRead(): (channelIds: readonly string[]) => Promise<boolean> {
  const zero = useZero();

  return useCallback(
    async (channelIds: readonly string[]): Promise<boolean> => {
      const uniqueIds = [...new Set(channelIds)];
      if (uniqueIds.length === 0) return true;

      const timestamp = Date.now();
      const results = await Promise.allSettled(
        chunk(uniqueIds, MARK_CHANNELS_VIEWED_MAX_BATCH).map(
          ids =>
            zero.mutate(mutators.channel.markChannelsAsViewed({ channelIds: ids, timestamp }))
              .server,
        ),
      );

      // `.server` resolves (not rejects) with `{ type: 'error' }` for application
      // errors, so both shapes count as a failure.
      const failed = results.some(r => r.status === 'rejected' || r.value?.type === 'error');
      if (failed) {
        toast.error(FAILURE_MESSAGE);
        return false;
      }
      return true;
    },
    [zero],
  );
}
