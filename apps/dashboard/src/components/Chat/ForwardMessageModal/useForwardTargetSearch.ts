import { useEffect, useMemo, useRef, useState } from 'react';
import { FuseWorker } from 'fuse.js/worker';
import fuseWorkerUrl from 'fuse.js/worker-script?worker&url';
import type { Channel } from '@xyne/shared';
import { CHANNEL_FUSE_OPTIONS, USER_FUSE_OPTIONS, normalizeChannelName } from '@xyne/shared/utils';
import type { User } from '../../../machines/stateMachine';

type UserDoc = Pick<User, 'id' | 'name' | 'displayName' | 'email'>;
type ChannelDoc = { id: string; name: string };
type IdMatch = { id: string; score?: number | undefined };

/**
 * Fuzzy matches for one query, both sets answering that same query. A missing set means the
 * workers failed and that part of the search has to run on the main thread instead.
 */
export interface ForwardTargetMatches {
  /** The query these matches answer: '' at rest, else the last query the workers finished. */
  query: string;
  users?: IdMatch[];
  channels?: IdMatch[];
}

const AT_REST: ForwardTargetMatches = { query: '' };

/**
 * Forward-modal recipient search with the people and channel fuzzy matching in web workers, so
 * typing never waits on it. Both are searched in parallel and reported together; until the
 * workers answer a new query, the previous matches stay.
 */
export function useForwardTargetSearch(
  query: string,
  users: User[],
  channels: Channel[],
): ForwardTargetMatches {
  const [matches, setMatches] = useState<ForwardTargetMatches>(AT_REST);
  const workersRef = useRef<{
    users: FuseWorker<UserDoc>;
    channels: FuseWorker<ChannelDoc>;
  } | null>(null);

  useEffect(() => {
    const workerOptions = { workerUrl: fuseWorkerUrl };
    const workers = {
      users: new FuseWorker<UserDoc>([], USER_FUSE_OPTIONS, workerOptions),
      channels: new FuseWorker<ChannelDoc>([], CHANNEL_FUSE_OPTIONS, workerOptions),
    };
    workersRef.current = workers;
    return (): void => {
      workers.users.terminate();
      workers.channels.terminate();
      workersRef.current = null;
    };
  }, []);

  // Keyed on the searched fields so presence or unread updates don't re-send the lists.
  const userDocsKey = useMemo(
    () =>
      JSON.stringify(
        users.map(({ id, name, displayName, email }) => ({ id, name, displayName, email })),
      ),
    [users],
  );
  const userDocs = useMemo(() => JSON.parse(userDocsKey) as UserDoc[], [userDocsKey]);
  // Channel names are normalized here because worker options can't carry a getFn.
  const channelDocsKey = useMemo(
    () =>
      JSON.stringify(channels.map(({ id, name }) => ({ id, name: normalizeChannelName(name) }))),
    [channels],
  );
  const channelDocs = useMemo(() => JSON.parse(channelDocsKey) as ChannelDoc[], [channelDocsKey]);

  // Collections are posted before searches (effects run in order), and each worker handles its
  // messages in order, so a search never runs against a stale collection. These only fail when
  // the modal closes mid-update.
  useEffect(() => {
    workersRef.current?.users.setCollection(userDocs).catch(() => {});
  }, [userDocs]);
  useEffect(() => {
    workersRef.current?.channels.setCollection(channelDocs).catch(() => {});
  }, [channelDocs]);

  useEffect(() => {
    if (!query) {
      setMatches(AT_REST);
      return;
    }
    const workers = workersRef.current;
    if (!workers) return;

    let stale = false;
    Promise.all([workers.users.search(query), workers.channels.search(normalizeChannelName(query))])
      .then(([userResults, channelResults]) => {
        if (stale) return;
        setMatches({
          query,
          users: userResults.map(r => ({ id: r.item.id, score: r.score })),
          channels: channelResults.map(r => ({ id: r.item.id, score: r.score })),
        });
      })
      .catch(() => {
        // Fall back to searching on the main thread if the workers fail.
        if (!stale) setMatches({ query });
      });
    return (): void => {
      stale = true;
    };
  }, [query, userDocs, channelDocs]);

  return matches;
}
