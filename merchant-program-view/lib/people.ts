import { useSyncExternalStore } from 'react';
import { avatarUrl, indexPeople, type People, type Person } from './ticketPanel';

export type { Person } from './ticketPanel';
import { spaces } from './xyne';

/**
 * Workspace people with their pictures, loaded once and shared, so every avatar in the app can show
 * the same photo Spaces shows. Only web picture URLs load inside the app; others fall back to initials.
 */

const EMPTY: People = { list: [], byId: new Map(), byName: new Map() };
let current: People = EMPTY;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

interface RawUser {
  id: string;
  name: string;
  displayName: string | null;
  picture: string | null;
  leftAt: number | null;
}

/**
 * Every user in one request. The SDK's listBasic fetches the whole list and then slices a page of 100
 * client-side, so paging through ~5k people would download it ~50 times; the resource's underlying
 * call returns the full array once. Falls back to paging if that internal ever goes away.
 */
async function allUsers(): Promise<RawUser[]> {
  const res = spaces.users as unknown as { call?: (def: object, args: unknown) => Promise<unknown> };
  if (typeof res.call === 'function') {
    const all = await res.call({ type: 'sdk', op: 'users.listBasic', kind: 'query' }, {});
    if (Array.isArray(all)) return all as RawUser[];
  }
  const out: RawUser[] = [];
  for (let offset = 0; ; ) {
    const page = await spaces.users.listBasic({ limit: 100, offset });
    out.push(...(page.items as RawUser[]));
    if (!page.hasMore) break;
    offset = page.nextOffset;
  }
  return out;
}

function load(): void {
  if (loading) return;
  loading = allUsers()
    .then(users => {
      // Keep people who left, so their names still show on old tickets; pickers filter them out.
      current = indexPeople(users.map(u => ({ id: u.id, name: u.displayName ?? u.name, picture: avatarUrl(u.picture), active: !u.leftAt })));
      listeners.forEach(l => l());
    })
    .catch(() => {
      loading = null;
    });
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  load();
  return () => listeners.delete(l);
}

export function usePeople(): People {
  return useSyncExternalStore(subscribe, () => current);
}

/** For non-React callers that already awaited a render. */
export function peopleNow(): People {
  load();
  return current;
}
