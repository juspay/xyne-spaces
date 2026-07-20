import { useSelector } from '@xstate/react';
import { useMemo } from 'react';
import { stateMachineActor } from '../machines/stateMachine.js';
import type { User } from '../machines/stateMachine.js';
import { useSharedAuthContext } from './context.js';
import { searchUsers as _searchUsers } from '../utils/search.js';
import { UserStatus } from '../zero/schema.js';

export { type User } from '../machines/stateMachine.js';

export function searchUsers(users: User[], query: string, limit = 10): User[] {
  return _searchUsers(users, query, limit);
}

// Shared users-by-id Map, rebuilt only when users array reference changes.
let _usersMapRef: User[] | null = null;
let _usersMap = new Map<string, User>();

// Force the users map to rebuild on next access. Call this after clearing the
// underlying users array (e.g. on workspace switch) so the cached Map doesn't
// keep old entries alive while the state-machine context is empty.
export function invalidateUsersMapCache(): void {
  _usersMapRef = null;
  _usersMap = new Map();
}

function getUsersMap(users: User[]): Map<string, User> {
  if (_usersMapRef !== users) {
    _usersMapRef = users;
    _usersMap = new Map(users.map(u => [u.id, u]));
  }
  return _usersMap;
}

export const useUsers = (): User[] => {
  const users = useSelector(stateMachineActor, state => state.context.users);
  return useMemo(() => users, [users]);
};

export const useUser = (userId: string): User | undefined => {
  // O(1) Map lookup inside selector. Re-renders only when this specific user
  // object changes (=== check on the returned User object, not the entire array).
  return useSelector(stateMachineActor, state =>
    getUsersMap(state.context.users).get(userId),
  );
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

/**
 * Returns only active users (status === ACTIVE)
 * Use this for assignment dropdowns, participant selection, etc.
 */
export const useActiveUsers = (): User[] => {
  const users = useUsers();
  return useMemo(() => users.filter(u => u.status === UserStatus.ACTIVE), [users]);
};

/**
 * Search only active users
 * Use this for assignment dropdowns where deactivated users should not appear
 */
export const useActiveUserSearch = (query: string, limit: number): User[] => {
  const users = useActiveUsers();
  return useMemo(() => searchUsers(users, query, limit), [users, query, limit]);
};
