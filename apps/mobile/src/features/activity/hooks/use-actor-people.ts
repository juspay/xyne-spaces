import { useMemo } from 'react';

import { useActiveUsers } from '@xyne/shared/hooks';

import { getUserDisplayName } from '@/src/utils/channel-utils';

import { AGENT_ACTOR_TYPES, USER_ACTOR_TYPES } from '../domain/activityActorFilter';
import type { ActivityActorKind } from '../model/preferences';

/** Enough to choose from without a long list to render; search reaches the rest. */
const PEOPLE_LIMIT = 15;

export type ActorPerson = {
  id: string;
  name: string;
  /** Lowercased name, the key the list is sorted by. */
  sortKey: string;
  haystack: string;
};

/**
 * Ordered by code unit, on a key built once per person.
 *
 * Not `localeCompare`: on Android, Hermes calls into ICU for every comparison,
 * and a workspace's worth of names sorted that way takes seconds. A plain
 * comparison of precomputed keys takes a few milliseconds. The cost is that
 * accented names sort by code point rather than by locale rules.
 */
const bySortKey = (a: ActorPerson, b: ActorPerson): number =>
  a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0;

/**
 * The people — or agents — the "From" picker offers. Reached by the classic
 * filters sheet; the Spaces tray's picker keeps its own copy of these rules.
 *
 * A short, name-sorted list, with whoever is chosen kept at the top so the
 * tick is always on screen. A query searches the whole set rather than
 * filtering the short list.
 */
export function useActorPeople(
  kind: ActivityActorKind,
  query: string,
  selectedId: string | null,
): readonly ActorPerson[] {
  const users = useActiveUsers();
  const types = kind === 'agent' ? AGENT_ACTOR_TYPES : USER_ACTOR_TYPES;

  const pool = useMemo<ActorPerson[]>(
    () =>
      users
        .filter(user => types.includes(user.userType))
        .map(user => {
          const name = getUserDisplayName(user);
          const sortKey = name.toLowerCase();
          return {
            id: user.id,
            name,
            sortKey,
            haystack: `${sortKey} ${user.email ?? ''}`.toLowerCase(),
          };
        })
        .sort(bySortKey),
    [types, users],
  );

  return useMemo<ActorPerson[]>(() => {
    const needle = query.trim().toLowerCase();
    if (needle !== '') {
      return pool.filter(person => person.haystack.includes(needle)).slice(0, PEOPLE_LIMIT);
    }
    const head = pool.slice(0, PEOPLE_LIMIT);
    if (selectedId === null || head.some(person => person.id === selectedId)) return head;
    const selected = pool.find(person => person.id === selectedId);
    return selected !== undefined ? [selected, ...head] : head;
  }, [pool, query, selectedId]);
}
