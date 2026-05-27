import { useMemo } from 'react';
import { useSelector } from '@xstate/react';
import { ActivityClassification } from '@xyne/shared';
import { stateMachineActor } from '../machines/stateMachine';

export const useUnreadThreadsCount = (): number => {
  const unreadActivities = useSelector(stateMachineActor, state => state.context.unreadActivities);

  return useMemo(() => {
    return (unreadActivities ?? []).filter(activity => {
      if (activity.isThreadActivity !== true) return false;
      const classification = activity.classification ?? ActivityClassification.PENDING;
      if (classification === ActivityClassification.SKIP) return false;
      return true;
    }).length;
  }, [unreadActivities]);
};
