import { useSelector } from '@xstate/react';
import { useMemo } from 'react';
import { stateMachineActor } from '../machines/stateMachine.js';
import type { User } from '../machines/stateMachine.js';
import { useSharedAuthContext } from './context.js';
import { searchUsers as _searchUsers } from '../utils/search.js';
import { shallowEqualUsers } from '../utils/comparators.js';

export { type User } from '../machines/stateMachine.js';

export function searchUsers(users: User[], query: string, limit = 10): User[] {
  return _searchUsers(users, query, limit);
}

export const useUsers = (): User[] => {
  const users = useSelector(stateMachineActor, state => state.context.users, shallowEqualUsers);
  return useMemo(() => users, [users]);
};

export const useUser = (userId: string): User | undefined => {
  const user = useSelector(stateMachineActor, state =>
    state.context.users.find(u => u.id === userId),
  );

  return user;
};

export const useSelf = (): User | undefined => {
  const context = useSharedAuthContext();
  const me = useUser(context.userID);
  return me;
};

export const useUserSearch = (query: string, limit: number): User[] => {
  const users = useUsers();
  return useMemo(() => searchUsers(users, query, limit), [users, query, limit]);
};
