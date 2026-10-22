import { useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';

import { useQuery } from '@/src/hooks/useQuery';
import { useZero } from '@/src/hooks/useZero';
import { mutators } from '@/src/zero/mutators';
import { queries } from '@/src/zero/queries';
import { stateMachineActor } from '@xyne/shared/machines';
import { findZeroDraftForComposer } from '@/src/components/input-composer/utils/drafts';
import { getZeroDraftFlushContent } from '@/src/components/input-composer/utils/flushComposerDraft';
import { haptics } from '@/src/utils/haptics';

export function useDmListSwipeActions() {
  const zero = useZero();
  const [zeroDrafts] = useQuery(queries.userDrafts());

  const toggleStar = useCallback(
    (channelId: string) => {
      void haptics.toggleOn();
      zero.mutate(mutators.channel.toggleStarred({ channelId, updatedAt: Date.now() }));
    },
    [zero],
  );

  const markAsRead = useCallback(
    (channelId: string) => {
      void haptics.success();
      void zero.mutate(
        mutators.channel.markChannelAsViewed({
          channelId,
          timestamp: Date.now(),
          draftMessageId: uuidv4(),
          draftMessage: getZeroDraftFlushContent(
            channelId,
            findZeroDraftForComposer(zeroDrafts ?? [], channelId, undefined)?.content ?? '',
          ),
        }),
      );
    },
    [zero, zeroDrafts],
  );

  const archive = useCallback(
    (channelId: string) => {
      void haptics.success();
      stateMachineActor.send({
        type: 'UPDATE_USER_CHANNEL_STATUS',
        channelId,
        updates: { isClosed: true },
      });
      void zero.mutate(mutators.channel.closeDm({ channelId, updatedAt: Date.now() }));
    },
    [zero],
  );

  return { toggleStar, markAsRead, archive };
}
