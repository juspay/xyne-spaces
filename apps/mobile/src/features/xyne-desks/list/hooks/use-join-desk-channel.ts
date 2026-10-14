import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { v4 as uuidv4 } from 'uuid';

import { useZero } from '@/src/hooks/useZero';
import { showMessageToast } from '@/src/utils/toast';
import { mutators } from '@/src/zero/mutators';
import { queries } from '@/src/zero/queries';

export type UseJoinDeskChannelReturn = {
  joiningIds: ReadonlySet<string>;
  joinDesk: (channelId: string, channelName: string) => void;
};

/**
 * Desk rows can come from IDB / state-machine fallback while the channel row is
 * not yet in Zero's local SQLite. `joinChannel` reads that row locally and throws
 * "Channel doesn't exist" if it's missing — so we materialize `userAllChannels`
 * into the replica before mutating.
 */
async function ensureChannelInZeroReplica(
  zero: ReturnType<typeof useZero>,
  channelId: string,
): Promise<boolean> {
  const channels = await zero.run(queries.userAllChannels(), { type: 'complete' });
  return (channels ?? []).some(channel => channel.id === channelId);
}

/**
 * Optimistic join for desk list rows.
 * Zero applies locally first → isJoined flips → Join button unmounts inline.
 */
export function useJoinDeskChannel(): UseJoinDeskChannelReturn {
  const zero = useZero();
  const [joiningIds, setJoiningIds] = useState<ReadonlySet<string>>(() => new Set());

  const joinDesk = useCallback(
    (channelId: string, channelName: string) => {
      if (!channelId || joiningIds.has(channelId)) return;

      setJoiningIds(prev => {
        const next = new Set(prev);
        next.add(channelId);
        return next;
      });

      void (async () => {
        try {
          const channelReady = await ensureChannelInZeroReplica(zero, channelId);
          if (!channelReady) {
            Alert.alert(
              'Could not join desk',
              "This desk isn't available right now. Pull to refresh or try again shortly.",
            );
            return;
          }

          const mutation = zero.mutate(
            mutators.channel.joinChannel({
              channelId,
              channelParticipantId: uuidv4(),
              channelUserStatusId: uuidv4(),
              timestamp: Date.now(),
            }),
          );

          await mutation.client;
          showMessageToast(`Joined "${channelName.trim() || 'desk'}"`, 'success');
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Please try again.';
          Alert.alert('Could not join desk', message);
        } finally {
          setJoiningIds(prev => {
            const next = new Set(prev);
            next.delete(channelId);
            return next;
          });
        }
      })();
    },
    [joiningIds, zero],
  );

  return { joiningIds, joinDesk };
}
