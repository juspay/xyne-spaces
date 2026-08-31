import { useEffect, useMemo, useState } from 'react';
import { TagMethod } from '@xyne/shared';
import { toast } from 'sonner';
import { tagsApi } from '../api/tagsApi';
import { recordingService } from '../services/Recording/recordingService';
import { logRecordingError } from '../utils/recordingUtils';

/** Resolved `Tag id -> { tag, method }`, shared across mounts so scrolling never re-fetches. */
const resolvedLabelCache = new Map<string, { tag: string; method: TagMethod }>();
/** Ids currently being fetched, so concurrent hook instances don't request the same id twice. */
const inFlightLabelRequests = new Map<string, Promise<void>>();
/** Notified whenever the cache is written outside of a fetch (e.g. confirming a suggestion). */
const cacheListeners = new Set<() => void>();

function notifyCacheListeners(): void {
  for (const listener of cacheListeners) listener();
}

/**
 * Optimistically flip a cached label's method (e.g. after confirming an
 * AI-suggested tag), without a re-fetch. Re-renders every mounted consumer.
 */
export function markResolvedRecordingLabelMethod(id: string, method: TagMethod): void {
  const existing = resolvedLabelCache.get(id);
  if (!existing) return;
  resolvedLabelCache.set(id, { ...existing, method });
  notifyCacheListeners();
}

/** Confirm an AI-suggested tag in place (optimistic MANUAL flip, reverts to `revertMethod` on failure). */
export async function confirmRecordingLabelSuggestion(
  id: string,
  revertMethod: TagMethod,
): Promise<void> {
  markResolvedRecordingLabelMethod(id, TagMethod.MANUAL);
  try {
    await tagsApi.confirmTag(id);
  } catch (err) {
    markResolvedRecordingLabelMethod(id, revertMethod);
    throw err;
  }
}

/** Persists a labels change, applying it locally only once the write succeeds. */
export function useApplyRecordingLabelsChange(
  applyLocally: (labels: string[]) => void,
): (externalId: string, nextLabels: string[], errorContext: string) => Promise<void> {
  return async (externalId, nextLabels, errorContext) => {
    try {
      await recordingService.updateRecording(externalId, { labels: nextLabels });
      applyLocally(nextLabels);
    } catch (err) {
      logRecordingError(errorContext, err);
      toast.error('Failed to update labels');
    }
  };
}

/** Never rejects: a failed batch leaves its ids uncached so a later render retries them. */
async function fetchLabelBatch(ids: string[]): Promise<void> {
  try {
    const tags = await tagsApi.getTagsByIds(ids);
    for (const { id, tag, method } of tags) {
      resolvedLabelCache.set(id, { tag, method });
    }
    for (const id of ids) {
      if (!resolvedLabelCache.has(id))
        resolvedLabelCache.set(id, { tag: id, method: TagMethod.MANUAL });
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
 *
 * `resolveMethod` reports 'llm' (still an AI suggestion, pending confirm/reject)
 * or 'manual' (applied) — defaults to 'manual' while still resolving so a
 * label never flashes as a suggestion chip before its real method is known.
 */
export function useResolvedRecordingLabels(labelIds: string[]): {
  resolveLabel: (id: string) => string;
  resolveMethod: (id: string) => TagMethod;
  isResolved: (id: string) => boolean;
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
    const listener = (): void => setCacheVersion(value => value + 1);
    cacheListeners.add(listener);
    return (): void => {
      cacheListeners.delete(listener);
    };
  }, []);

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
    return (id: string): string => resolvedLabelCache.get(id)?.tag ?? id;
  }, [cacheVersion]);

  const resolveMethod = useMemo(() => {
    return (id: string): TagMethod => resolvedLabelCache.get(id)?.method ?? TagMethod.MANUAL;
  }, [cacheVersion]);

  const isResolved = useMemo(() => {
    return (id: string): boolean => resolvedLabelCache.has(id);
  }, [cacheVersion]);

  return { resolveLabel, resolveMethod, isResolved, isResolving };
}
