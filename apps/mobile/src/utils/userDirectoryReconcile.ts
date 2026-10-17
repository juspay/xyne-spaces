import type { User } from '@/src/machines/appStateMachine';

export type UserDirectoryReconcileResult = {
  users: User[];
  reused: number;
  changed: number;
  added: number;
  removed: number;
  isNoop: boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const areValuesEqual = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) {
    return true;
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }

    return left.every((value, index) => areValuesEqual(value, right[index]));
  }

  if (!isRecord(left) || !isRecord(right)) {
    return false;
  }

  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return Array.from(keys).every(key => areValuesEqual(left[key], right[key]));
};

const areUsersEqual = (left: User, right: User): boolean => areValuesEqual(left, right);

/**
 * Reconcile a complete directory without replacing objects whose displayed
 * and persisted fields did not change. The incoming order remains canonical;
 * removed users naturally disappear from the returned array.
 */
export const reconcileUserDirectory = (
  current: readonly User[],
  incoming: readonly User[],
): UserDirectoryReconcileResult => {
  const currentById = new Map(current.map(user => [user.id, user]));
  const incomingIds = new Set<string>();
  const users: User[] = [];
  let reused = 0;
  let changed = 0;
  let added = 0;

  for (const incomingUser of incoming) {
    incomingIds.add(incomingUser.id);
    const currentUser = currentById.get(incomingUser.id);

    if (currentUser && areUsersEqual(currentUser, incomingUser)) {
      users.push(currentUser);
      reused += 1;
      continue;
    }

    users.push(incomingUser);
    if (currentUser) {
      changed += 1;
    } else {
      added += 1;
    }
  }

  let removed = 0;
  for (const currentUser of current) {
    if (!incomingIds.has(currentUser.id)) {
      removed += 1;
    }
  }

  const isNoop =
    users.length === current.length && users.every((user, index) => user === current[index]);

  return { users, reused, changed, added, removed, isNoop };
};
