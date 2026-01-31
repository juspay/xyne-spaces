import { useSelector } from '@xstate/react';
import { stateMachineActor, UnreadCounts } from '../machines/stateMachine';
import { useMemo } from 'react';

export const useAllUnreadCount = (): UnreadCounts => {
  const userChannelStatuses = useSelector(
    stateMachineActor,
    state => state.context.userChannelStatuses,
  );

  return useMemo(() => {
    const counts: UnreadCounts = {};
    userChannelStatuses.forEach(status => {
      counts[status.channelId] = status.unreadCount || 0;
    });
    return counts;
  }, [userChannelStatuses]);
};
