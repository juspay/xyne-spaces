import { useMemo } from 'react';
import { useSelector } from '@xstate/react';
import { stateMachineActor } from '../machines/stateMachine';

type UnreadActivity = {
  id: string;
  actorAction: string;
  actionSource: string;
  callId: string | null;
};

/** Unread activities matching a stable `predicate`, from existing state (no query). */
export const useUnreadActivities = (
  predicate: (activity: UnreadActivity) => boolean,
): UnreadActivity[] => {
  const unreadActivities = useSelector(stateMachineActor, state => state.context.unreadActivities);

  return useMemo(() => (unreadActivities ?? []).filter(predicate), [unreadActivities, predicate]);
};
