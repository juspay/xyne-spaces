import { useEffect } from 'react';
import { mutators } from '../zero/mutators';
import { useUnreadActivities } from './useUnreadActivities';
import { useZero } from './useZero';

const isMissedCall = (activity: { actorAction: string }): boolean =>
  activity.actorAction === 'missed_call';

/** Unread missed-call count for the Calls sidebar badge. */
export const useMissedCallCount = (): number => useUnreadActivities(isMissedCall).length;

/** Mount on the Calls screen to clear the sidebar missed-call badge. */
export const useMarkMissedCallsReadOnVisit = (): void => {
  const zero = useZero();
  const hasUnread = useMissedCallCount() > 0;

  useEffect(() => {
    if (!hasUnread) return;
    void zero.mutate(mutators.activities.markMissedCallsAsRead({}));
  }, [hasUnread, zero]);
};
