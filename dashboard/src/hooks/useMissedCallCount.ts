import { queries } from '../zero/queries';
import { useMemo } from 'react';
import { useCachedQuery } from './useCachedQuery';

/**
 * Hook to get the total missed call count across all channels
 * Uses Activity table with actorAction = 'missed_call' and isRead = false
 */
export const useMissedCallCount = (): number => {
  const [missedCallActivities] = useCachedQuery(queries.userMissedCalls());

  return useMemo(() => {
    if (!missedCallActivities) {
      return 0;
    }
    return missedCallActivities.length;
  }, [missedCallActivities]);
};
