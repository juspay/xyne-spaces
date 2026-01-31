import { queries } from '../zero/queries';
import { useMemo } from 'react';
import { ActivityClassification } from '@xyne/shared';
import { useCachedQuery } from './useCachedQuery';

export const useUnreadThreadsCount = (): number => {
  const [activities] = useCachedQuery(queries.userUnreadThreadActivities());
  const count = useMemo(() => {
    return activities.filter(activity => {
      const classification = activity.classification ?? ActivityClassification.PENDING;
      if (classification === ActivityClassification.SKIP) return false;
      return true;
    }).length;
  }, [activities]);
  return count;
};
