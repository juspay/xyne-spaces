import { useEffect, useMemo, useRef, useState } from 'react';
import { FuseWorker } from 'fuse.js/worker';
import fuseWorkerUrl from 'fuse.js/worker-script?worker&url';
import { CHANNEL_FUSE_OPTIONS, normalizeChannelName } from '@xyne/shared/utils';
import { isDMChannel } from '../components/Chat/ChatDirectory/ChatDirectory.utils';
import { filterChannelsBySearchableNames, type ChannelSearchItem } from '../utils/rankingUtils';

type ChannelDoc = { id: string; name: string };
type WorkerMatch = { id: string; score?: number | undefined };
// `matches` is missing when the workers failed and the search runs on the main thread instead.
type Found = { query: string; matches?: WorkerMatch[] };

/**
 * Cmd+K channel search. The fuzzy match runs in web workers so long queries don't stall typing;
 * results are the same as `filterChannelsBySearchableNames`. `isPending` is true while there is a
 * query but the workers haven't answered one yet, so `channels` is still the unfiltered list.
 */
export function useWorkerChannelSearch<T extends ChannelSearchItem>(
  items: T[],
  query: string,
): { channels: T[]; isPending: boolean } {
  const [found, setFound] = useState<Found | null>(null);
  const workerRef = useRef<FuseWorker<ChannelDoc> | null>(null);

  useEffect(() => {
    const worker = new FuseWorker<ChannelDoc>([], CHANNEL_FUSE_OPTIONS, {
      workerUrl: fuseWorkerUrl,
    });
    workerRef.current = worker;
    return (): void => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  // DMs match on participant names on the main thread; only regular channels go to the workers.
  // Keyed on the names so unread or ordering updates don't re-send the list.
  const docsKey = useMemo(
    () =>
      JSON.stringify(
        items
          .filter(({ channel }) => !isDMChannel(channel.scopeType))
          .map(({ channel }) => ({ id: channel.id, name: normalizeChannelName(channel.name) })),
      ),
    [items],
  );
  const docs = useMemo(() => JSON.parse(docsKey) as ChannelDoc[], [docsKey]);
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
      .search(normalizeChannelName(query))
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

  // Ranked here rather than stored, so channel updates re-rank in the same render. Until the
  // workers answer, the previous query's results stay on screen.
  const hasQuery = query.trim() !== '';
  const channels = useMemo(() => {
    if (!hasQuery || !found) return filterChannelsBySearchableNames(items, '');
    return filterChannelsBySearchableNames(
      items,
      found.query,
      found.matches ? { regularFuseMatches: found.matches } : {},
    );
  }, [items, hasQuery, found]);
  return { channels, isPending: hasQuery && !found };
}
