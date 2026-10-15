import { useCallback, useMemo } from 'react';
import { useSelector } from '@xstate/react';
import { v4 as uuidv4 } from 'uuid';
import { ChannelSortOrder } from '@xyne/shared';
import { useQuery } from './useQuery';
import { useZero } from './useZero';
import { stateMachineActor } from '@/src/machines/appStateMachine';
import { queries } from '@/src/zero/queries';
import { mutators } from '@/src/zero/mutators';
import {
  DEFAULT_CHANNEL_FILTER,
  type ChannelGroupPreference,
} from '@/src/components/chat/channel-list/channel-group-preferences';

type BuiltInPreference = Omit<ChannelGroupPreference, 'sortOrder'> & {
  sortOrder: ChannelSortOrder;
};
type ChannelGroupPreferences = {
  channels: BuiltInPreference;
  starred: BuiltInPreference;
  update: (group: 'channels' | 'starred', patch: Partial<BuiltInPreference>) => void;
};

export function useChannelGroupPreferences(): ChannelGroupPreferences {
  const zero = useZero();
  const [queried] = useQuery(queries.getCurrentUserPreference({}));
  const fallback = useSelector(stateMachineActor, state => state.context.userPreference);
  const preference = queried ?? fallback;
  const update = useCallback(
    (
      group: 'channels' | 'starred',
      patch: Partial<Omit<ChannelGroupPreference, 'sortOrder'>> & { sortOrder?: ChannelSortOrder },
    ) => {
      void zero.mutate(
        mutators.userPreference.setSidebarGroupPreference({
          id: preference?.id ?? uuidv4(),
          group,
          ...patch,
          timestamp: Date.now(),
        }),
      );
    },
    [preference?.id, zero],
  );
  return useMemo(
    () => ({
      channels: {
        filterMode: preference?.channelFilterMode ?? DEFAULT_CHANNEL_FILTER,
        sortOrder: preference?.channelSortOrder ?? ChannelSortOrder.RECENCY,
      },
      starred: {
        filterMode: preference?.starredFilterMode ?? DEFAULT_CHANNEL_FILTER,
        sortOrder: preference?.starredSortOrder ?? ChannelSortOrder.UNREAD,
      },
      update,
    }),
    [
      preference?.channelFilterMode,
      preference?.channelSortOrder,
      preference?.starredFilterMode,
      preference?.starredSortOrder,
      update,
    ],
  );
}
