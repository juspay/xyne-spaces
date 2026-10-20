import { useSelector } from '@xstate/react';

import { stateMachineActor } from '@/src/machines/stateMachine';

import { isAgentUserType } from '../model/agent';

/**
 * Whether a sender is a bot, app or agent. A narrow read of the workspace
 * users the app already holds: it re-renders the row only when this answer
 * changes, and never starts a query, so a sender missing from the set is
 * simply not tagged.
 */
export function useSenderIsAgent(senderId: string): boolean {
  return useSelector(stateMachineActor, state =>
    senderId
      ? isAgentUserType(state.context.users.find(user => user.id === senderId)?.userType)
      : false,
  );
}
