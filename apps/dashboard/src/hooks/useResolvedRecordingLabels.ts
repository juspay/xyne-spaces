import { useEffect, useMemo, useState } from 'react';
import { tagsApi } from '../api/tagsApi';

/** Resolved `Tag id -> display text`, shared across mounts so scrolling never re-fetches. */
const resolvedLabelCache = new Map<string, string>();
/** Ids currently being fetched, so concurrent hook instances don't request the same id twice. */
const inFlightLabelRequests = new Map<string, Promise<void>>();

/** Never rejects: a failed batch leaves its ids uncached so a later render retries them. */
async function fetchLabelBatch(ids: string[]): Promise<void> {
  try {
    const tags = await tagsApi.getTagsByIds(ids);
    for (const { id, tag } of tags) {
      resolvedLabelCache.set(id, tag);
    }
    for (const id of ids) {
      if (!resolvedLabelCache.has(id)) resolvedLabelCache.set(id, id);
    }
  } catch {
    // Intentionally uncached.
  } finally {
    for (const id of ids) inFlightLabelRequests.delete(id);
  }
}

async function resolveMissingLabels(ids: string[]): Promise<void> {
  const idsToFetch: string[] = [];
  const pending = new Set<Promise<void>>();

  for (const id of ids) {
    if (resolvedLabelCache.has(id)) continue;
    const existing = inFlightLabelRequests.get(id);
    if (existing) pending.add(existing);
    else idsToFetch.push(id);
  }

  if (idsToFetch.length > 0) {
    const request = fetchLabelBatch(idsToFetch);
    for (const id of idsToFetch) inFlightLabelRequests.set(id, request);
    pending.add(request);
  }

  await Promise.all([...pending]);
}

/**
 * Recording labels (Call.labels) store Tag *ids*, not display text (see
 * noteTakerTranscriptService.generateAndSaveLabels). This batches all
 * currently-visible label ids into one request and returns a resolver.
 */
export function useResolvedRecordingLabels(labelIds: string[]): {
  resolveLabel: (id: string) => string;
  isResolving: boolean;
} {
  const [cacheVersion, setCacheVersion] = useState(0);
  const [isResolving, setIsResolving] = useState(false);

  const uniqueIds = useMemo(() => [...new Set(labelIds)], [labelIds]);
  const unresolvedIds = useMemo(
    () => uniqueIds.filter(id => !resolvedLabelCache.has(id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [uniqueIds, cacheVersion],
  );
  const unresolvedKey = unresolvedIds.join(',');

  useEffect(() => {
    if (unresolvedIds.length === 0) return;

    let cancelled = false;
    setIsResolving(true);

    void resolveMissingLabels(unresolvedIds).then(() => {
      // Cache writes live in the request itself, so a run cancelled by new ids
      // arriving mid-flight still benefits the render that replaced it.
      if (cancelled) return;
      setIsResolving(false);
      if (!unresolvedIds.some(id => resolvedLabelCache.has(id))) return;
      setCacheVersion(value => value + 1);
    });

    return (): void => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unresolvedKey]);

  const resolveLabel = useMemo(() => {
    return (id: string): string => resolvedLabelCache.get(id) ?? id;
  }, [cacheVersion]);

  return { resolveLabel, isResolving };
}
