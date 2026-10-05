import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { stateMachineActor } from '../machines/stateMachine.js';
import type { User } from '../machines/stateMachine.js';
import { queries } from '../zero/queries.js';
import { useQuery } from './useQuery.js';
import { useUser, useUsersById } from './useUsers.js';

/**
 * On-demand user resolution.
 *
 * The workspace user list is loaded once at boot (getUsersV2, REST + Zero delta).
 * A message can still render before its sender is in that list: cold boot before
 * the list lands, or a user who joined after the cached list was written. Instead
 * of making every message query `.related('sender')` (users.updatedAt moves on
 * every presence heartbeat, so that would fan out to every open message view),
 * components register the ids they need here, and ONE resolver fetches only the
 * ids missing from the store via `usersByIds`.
 *
 * When every sender is already in the store this costs a Map lookup per message
 * and runs no query.
 */

// Cap each fetch. More missing ids than this are fetched in later batches.
const MAX_IDS_PER_FETCH = 200;
// Collect ids from bubbles that mount in the same burst into one query.
const BATCH_DELAY_MS = 30;

const requested = new Map<string, number>();
const notFound = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

function emit(): void {
  version++;
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getVersion(): number {
  return version;
}

function register(userId: string): () => void {
  const count = requested.get(userId) ?? 0;
  requested.set(userId, count + 1);
  if (count === 0) emit();
  return () => {
    const next = (requested.get(userId) ?? 1) - 1;
    if (next <= 0) requested.delete(userId);
    else requested.set(userId, next);
  };
}

/** Clear the not-found set, for example on workspace switch. */
export function resetEnsureUsersState(): void {
  notFound.clear();
  emit();
}

export type EnsuredUserStatus = 'resolved' | 'loading' | 'not_found';

/**
 * Returns the user for `userId` and asks the resolver to fetch it when it is not
 * in the store yet. `status` is `loading` until the fetch has completed, so the
 * caller can show a placeholder instead of a fake name.
 */
export function useEnsureUser(userId: string | null | undefined): {
  user: User | undefined;
  status: EnsuredUserStatus;
} {
  const id = userId ?? '';
  const user = useUser(id);
  const isMissing = id !== '' && user === undefined;

  useEffect(() => {
    if (!isMissing) return;
    return register(id);
  }, [id, isMissing]);

  useSyncExternalStore(subscribe, getVersion, getVersion);

  if (user) return { user, status: 'resolved' };
  if (id === '' || notFound.has(id)) return { user: undefined, status: 'not_found' };
  return { user: undefined, status: 'loading' };
}

/**
 * Mount exactly once, inside the authenticated app. Fetches the users that
 * mounted components asked for and that are not in the store, then merges them.
 */
export function useMissingUsersResolver(): void {
  const usersById = useUsersById();
  const storeVersion = useSyncExternalStore(subscribe, getVersion, getVersion);

  const missingKey = useMemo(() => {
    const ids: string[] = [];
    for (const id of requested.keys()) {
      if (!usersById.has(id) && !notFound.has(id)) ids.push(id);
    }
    ids.sort();
    return ids.slice(0, MAX_IDS_PER_FETCH).join(',');
    // storeVersion changes whenever the requested set changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usersById, storeVersion]);

  // Wait for the burst of mounting bubbles to settle so one query covers them.
  const [batchKey, setBatchKey] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setBatchKey(missingKey), BATCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [missingKey]);

  const userIds = useMemo(() => (batchKey ? batchKey.split(',') : []), [batchKey]);
  const [rows, details] = useQuery(queries.usersByIds({ userIds }), {
    enabled: userIds.length > 0,
    ttl: '5m',
  });

  useEffect(() => {
    if (userIds.length === 0) return;
    const found = (rows ?? []) as unknown as User[];
    const toMerge = found.filter(u => !usersById.has(u.id));
    if (toMerge.length > 0) {
      // usersUpdatedAt 0: these rows must not move the getUsersV2 delta watermark,
      // or users updated between the watermark and now would be skipped.
      stateMachineActor.send({ type: 'MERGE_USERS', users: toMerge, usersUpdatedAt: 0 });
    }
    if (details.type !== 'complete') return;
    const foundIds = new Set(found.map(u => u.id));
    let changed = false;
    for (const id of userIds) {
      if (!foundIds.has(id) && !usersById.has(id) && !notFound.has(id)) {
        notFound.add(id);
        changed = true;
      }
    }
    if (changed) emit();
  }, [rows, details.type, userIds, usersById]);
}
