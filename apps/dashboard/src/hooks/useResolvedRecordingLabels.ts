import { useEffect, useMemo, useRef, useState } from 'react';
import { tagsApi } from '../api/tagsApi';

// Module-level cache shared across mounts/pagination so re-rendering with an
// overlapping set of ids (e.g. scrolling the recordings list) never re-fetches
// ids we've already resolved.
const resolvedLabelCache = new Map<string, string>();

/**
 * Recording labels (Call.labels) store Tag *ids*, not display text (see
 * Tag model / noteTakerTranscriptService.generateAndSaveLabels) — nothing
 * resolves them back to the tag's actual value before this hook, which is
 * why raw ids used to leak into the UI. This batches all currently-visible
 * label ids into a single request and returns a resolver function.
 */
export function useResolvedRecordingLabels(labelIds: string[]): {
  resolveLabel: (id: string) => string;
  isResolving: boolean;
} {
  const [cacheVersion, setCacheVersion] = useState(0);
  const isResolvingRef = useRef(false);
  const [isResolving, setIsResolving] = useState(false);

  const uniqueIds = useMemo(() => [...new Set(labelIds)], [labelIds]);
  const unresolvedIds = useMemo(
    () => uniqueIds.filter(id => !resolvedLabelCache.has(id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [uniqueIds, cacheVersion],
  );
  const unresolvedKey = unresolvedIds.join(',');

  useEffect(() => {
    if (unresolvedIds.length === 0 || isResolvingRef.current) return;

    isResolvingRef.current = true;
    setIsResolving(true);
    let cancelled = false;

    tagsApi
      .getTagsByIds(unresolvedIds)
      .then(tags => {
        if (cancelled) return;
        for (const { id, tag } of tags) {
          resolvedLabelCache.set(id, tag);
        }
        // Ids that resolved to nothing (deleted tag, etc.) still need a cache
        // entry so we don't refetch them forever — fall back to the id itself.
        for (const id of unresolvedIds) {
          if (!resolvedLabelCache.has(id)) resolvedLabelCache.set(id, id);
        }
        setCacheVersion(value => value + 1);
      })
      .catch(() => {
        if (cancelled) return;
        for (const id of unresolvedIds) {
          if (!resolvedLabelCache.has(id)) resolvedLabelCache.set(id, id);
        }
        setCacheVersion(value => value + 1);
      })
      .finally(() => {
        if (cancelled) return;
        isResolvingRef.current = false;
        setIsResolving(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unresolvedKey]);

  const resolveLabel = useMemo(() => {
    return (id: string): string => resolvedLabelCache.get(id) ?? id;
  }, [cacheVersion]);

  return { resolveLabel, isResolving };
}
