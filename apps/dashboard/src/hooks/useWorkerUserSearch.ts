import { useEffect, useMemo, useRef, useState } from 'react';
import { FuseWorker } from 'fuse.js/worker';
import fuseWorkerUrl from 'fuse.js/worker-script?worker&url';
import { useUsers } from '@xyne/shared/hooks';
import { searchUsers, USER_FUSE_OPTIONS } from '@xyne/shared/utils';
import type { User } from '../machines/stateMachine';

type UserDoc = Pick<User, 'id' | 'name' | 'displayName' | 'email'>;
type WorkerMatch = { id: string; score?: number | undefined };
// `matches` is missing when the workers failed and the search runs on the main thread instead.
type Found = { query: string; matches?: WorkerMatch[] };

/**
 * Cmd+K people search. The fuzzy match runs in web workers so long queries don't stall typing;
 * results are the same as `useUserSearch`.
 */
export function useWorkerUserSearch(query: string, limit: number): User[] {
  const users = useUsers();
  const [found, setFound] = useState<Found | null>(null);
  const workerRef = useRef<FuseWorker<UserDoc> | null>(null);

  useEffect(() => {
    const worker = new FuseWorker<UserDoc>([], USER_FUSE_OPTIONS, { workerUrl: fuseWorkerUrl });
    workerRef.current = worker;
    return (): void => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  // Keyed on the searched fields so presence or status updates don't re-send the list.
  const docsKey = useMemo(
    () =>
      JSON.stringify(
        users.map(({ id, name, displayName, email }) => ({ id, name, displayName, email })),
      ),
    [users],
  );
  const docs = useMemo(() => JSON.parse(docsKey) as UserDoc[], [docsKey]);
  useEffect(() => {
    // Only fails when the palette closes mid-update.
    workerRef.current?.setCollection(docs).catch(() => {});
  }, [docs]);

  useEffect(() => {
    if (!query.trim()) {
      setFound(null);
      return;
    }
    const worker = workerRef.current;
    if (!worker) return;

    let stale = false;
    worker
      .search(query)
      .then(results => {
        if (stale) return;
        setFound({ query, matches: results.map(r => ({ id: r.item.id, score: r.score })) });
      })
      .catch(() => {
        // Fall back to searching on the main thread if the workers fail.
        if (!stale) setFound({ query });
      });
    return (): void => {
      stale = true;
    };
  }, [query, docs]);

  // Ranked here rather than stored, so user updates re-rank in the same render. Until the
  // workers answer, the previous query's results stay on screen.
  const hasQuery = query.trim() !== '';
  return useMemo(() => {
    if (!hasQuery || !found) return searchUsers(users, '', limit);
    if (!found.matches) return searchUsers(users, found.query, limit);
    const byId = new Map(users.map(user => [user.id, user]));
    const fuseMatches = found.matches.flatMap(({ id, score }) => {
      const user = byId.get(id);
      return user ? [{ item: user, score }] : [];
    });
    return searchUsers(users, found.query, limit, fuseMatches);
  }, [users, hasQuery, limit, found]);
}
