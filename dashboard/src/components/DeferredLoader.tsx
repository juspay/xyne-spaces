import { useEffect } from 'react';
import { queries } from '../zero/queries';
import { useCachedQuery } from '../hooks/useCachedQuery';
import { stateMachineActor } from '../machines/stateMachine';

/**
 * Subscribes to deferred zero queries and pushes results into the state machine.
 * Rendered inside InitialStateLoader after hydration is complete.
 */
export const DeferredLoader: React.FC = () => {
  const [unreadActivities] = useCachedQuery(queries.userUnreadActivities());

  useEffect(() => {
    stateMachineActor.send({
      type: 'SET_UNREAD_ACTIVITIES',
      unreadActivities: unreadActivities ?? [],
    });
  }, [unreadActivities]);

  return null;
};
