import { useEffect } from 'react';
import { mutators } from '../zero/mutators';
import { useUnreadActivities } from './useUnreadActivities';
import { useZero } from './useZero';
import { usePageCoverage, whenShown } from './usePageCoverage';

const isMissedCall = (activity: { actorAction: string }): boolean =>
  activity.actorAction === 'missed_call';

/** Unread missed-call count for the Calls sidebar badge. */
export const useMissedCallCount = (): number => useUnreadActivities(isMissedCall).length;

/** Mount on the Calls screen to clear the sidebar missed-call badge. */
export const useMarkMissedCallsReadOnVisit = (): void => {
  const zero = useZero();
  const hasUnread = useMissedCallCount() > 0;
  // Under full-page search the Calls screen is off screen: calls missed meanwhile stay unread
  // until it is back.
  const coverage = usePageCoverage();

  useEffect(() => {
    if (!hasUnread) return undefined;
    return whenShown(coverage, () => {
      void zero.mutate(mutators.activities.markMissedCallsAsRead({}));
    });
  }, [hasUnread, zero, coverage]);
};
