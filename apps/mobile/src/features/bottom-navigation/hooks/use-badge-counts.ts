import { useMemo } from 'react';
import { useSelector } from '@xstate/react';

import { useActivityBadgeModel } from '@/src/features/activity/hooks/useActivityBadgeModel';
import { stateMachineActor } from '@/src/machines/appStateMachine';
import { selectTabBadgeCounts, type TabBadgeCounts } from '../model/badge-counts';

export type { TabBadgeCounts };

const EMPTY_STATUSES: never[] = [];
const EMPTY_CHANNELS: never[] = [];

/** Live wiring for `selectTabBadgeCounts`, which owns the rules. */
export function useTabBadgeCounts(): TabBadgeCounts {
  const userChannelStatuses = useSelector(
    stateMachineActor,
    state => state.context.userChannelStatuses ?? EMPTY_STATUSES,
  );
  const visibleChannels = useSelector(
    stateMachineActor,
    state => state.context.visibleChannels ?? EMPTY_CHANNELS,
  );
  const { count: activityCount, unreadActivities } = useActivityBadgeModel();

  return useMemo(
    () =>
      selectTabBadgeCounts({
        visibleChannels,
        userChannelStatuses,
        unreadActivities,
        activityCount,
      }),
    [activityCount, unreadActivities, userChannelStatuses, visibleChannels],
  );
}
