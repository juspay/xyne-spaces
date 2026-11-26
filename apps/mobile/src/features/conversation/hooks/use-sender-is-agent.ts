import { useSelector } from '@xstate/react';

import { stateMachineActor } from '@/src/machines/stateMachine';

import { isAgentUserType } from '../model/agent';

type Users = ReadonlyArray<{ id: string; userType?: string | null | undefined }>;

// One set per users array, shared by every row: the selector runs on each store
// change, and a lookup per row stays constant instead of a scan of the list.
const agentIdsByUsers = new WeakMap<Users, ReadonlySet<string>>();

function agentIdsOf(users: Users): ReadonlySet<string> {
  let ids = agentIdsByUsers.get(users);
  if (!ids) {
    ids = new Set(users.filter(user => isAgentUserType(user.userType)).map(user => user.id));
    agentIdsByUsers.set(users, ids);
  }
  return ids;
}

/**
 * Whether a sender is a bot, app or agent. A narrow read of the workspace
 * users the app already holds: it re-renders the row only when this answer
 * changes, and never starts a query, so a sender missing from the set is
 * simply not tagged.
 */
export function useSenderIsAgent(senderId: string): boolean {
  return useSelector(stateMachineActor, state =>
    senderId ? agentIdsOf(state.context.users).has(senderId) : false,
  );
}
