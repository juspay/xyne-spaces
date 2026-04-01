import { useSelector } from '@xstate/react';
import { useMemo } from 'react';
import { stateMachineActor, type User } from '../machines/stateMachine';
import { useAuthContextValues } from './useAuth';
import Fuse from 'fuse.js';

const shallowEqualUsers = (a: User[], b: User[]): boolean => {
  if (a.length !== b.length) return false;
  return a.every((user, index) => {
    const otherUser = b[index];
    return (
      otherUser &&
      user.id === otherUser.id &&
      user.name === otherUser.name &&
      user.email === otherUser.email &&
      user.status === otherUser.status &&
      user.displayName === otherUser.displayName
    );
  });
};

export type SearchPriorities = {
  name?: number;
  email?: number;
  displayName?: number;
};

export function searchUsers(users: User[], query: string, limit = 10): User[] {
  if (!query.trim()) return users.slice(0, limit);

  const q = query.toLowerCase();

  const fuse = new Fuse(users, {
    keys: [
      { name: 'name', weight: 2 },
      { name: 'email', weight: 1 },
      { name: 'displayName', weight: 1.5 },
    ],

    threshold: 0.2,
    ignoreLocation: true,
    includeScore: true,
    minMatchCharLength: 2,
    isCaseSensitive: false,
  });

  const results = fuse.search(query);

  const rescored = results.map(r => {
    const name = r.item.name.toLowerCase();
    const email = r.item.email.toLowerCase();
    const displayName = r.item.displayName?.toLowerCase() || '';

    // Base score is between 0 (perfect) and 1 (bad)
    let finalScore = r.score ?? 1;

    if (name.startsWith(q)) {
      finalScore -= 10;
    } else if (name.includes(' ' + q)) {
      finalScore -= 5;
    } else if (displayName.startsWith(q)) {
      finalScore -= 8;
    } else if (displayName.includes(' ' + q)) {
      finalScore -= 4;
    } else if (email.startsWith(q)) {
      finalScore -= 2;
    }

    return {
      item: r.item,
      score: finalScore,
    };
  });

  return rescored
    .sort((a, b) => {
      if (a.score !== b.score) {
        return a.score - b.score;
      }
      return a.item.name.localeCompare(b.item.name);
    })
    .slice(0, limit)
    .map(r => r.item);
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
  const context = useAuthContextValues();
  const me = useUser(context.userID);
  return me;
};

export const useUserSearch = (query: string, limit: number): User[] => {
  const users = useUsers();
  return useMemo(() => searchUsers(users, query, limit), [users, query, limit]);
};
