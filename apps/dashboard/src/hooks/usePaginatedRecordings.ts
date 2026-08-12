import { useState, useRef, useEffect, useCallback } from 'react';
import { useSelector } from '@xstate/react';
import { QueryResultType } from '@rocicorp/zero';
import { queries } from '../zero/queries';
import { useCachedQuery } from './useCachedQuery';
import { queryCacheActor } from '../machines/queryCacheMachine';
import { useZero } from './useZero';

export type RecordingEntry = QueryResultType<typeof queries.userRecordings>[number];

const FETCH_LIMIT = 20;
const refreshListeners = new Set<() => void>();

export function refreshRecordings(): void {
  for (const listener of refreshListeners) listener();
}

type RecordingCursor = { id: string; startedAt: number } | null;

export function removeRecordingsFromCache(externalIds: string[]): void {
  if (externalIds.length === 0) return;
  const idSet = new Set(externalIds);
  const current = queryCacheActor.getSnapshot().context.recordings;
  const filtered = current.recordings.filter(r => !idSet.has(r.externalId));
  if (filtered.length === current.recordings.length) return;
  queryCacheActor.send({
    type: 'HYDRATE_RECORDINGS',
    data: { recordings: filtered, hasMore: current.hasMore },
  });
}

interface UsePaginatedRecordingsReturn {
  recordings: RecordingEntry[];
  hasMoreRecordings: boolean;
  loadMoreRecordings: () => void;
  onVisibleRangeChanged: (startIndex: number) => void;
  isLoading: boolean;
}

export function usePaginatedRecordings(): UsePaginatedRecordingsReturn {
  const zero = useZero();
  const isFetchingRef = useRef(false);

  const [windowCursor, setWindowCursor] = useState<RecordingCursor>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Accumulated state lives in queryCacheMachine (XState + IndexedDB) — survives unmount/remount
  const accumulatedRecordings = useSelector(queryCacheActor, s => s.context.recordings.recordings);
  const hasMoreRecordings = useSelector(queryCacheActor, s => s.context.recordings.hasMore);

  // Ref mirrors state so async callbacks always read current value without stale closures
  const recordingsRef = useRef(accumulatedRecordings);
  recordingsRef.current = accumulatedRecordings;

  // The live window. At cursor `null` it covers the newest page (initial load +
  // new-at-top); as the cursor follows scroll it covers the viewed page.
  const [windowPage, windowDetails] = useCachedQuery(
    queries.userRecordings({ limit: FETCH_LIMIT, start: windowCursor }),
  );

  useEffect(() => {
    if (!windowPage || windowDetails.type !== 'complete') return;
    queryCacheActor.send({
      type: 'MERGE_RECORDINGS_PAGE',
      page: windowPage as RecordingEntry[],
      hasMore: windowPage.length === FETCH_LIMIT,
      start: windowCursor,
    });
  }, [windowPage, windowDetails.type, windowCursor]);

  // Aligns the live window to the page containing the first visible row.
  const onVisibleRangeChanged = useCallback((startIndex: number) => {
    const list = recordingsRef.current;
    if (list.length === 0) return;

    const pageStart = Math.floor(Math.max(0, startIndex) / FETCH_LIMIT) * FETCH_LIMIT;
    // Cursor is the row *before* the page (exclusive start); first page → null
    const anchor = pageStart === 0 ? null : list[pageStart - 1];
    const next: RecordingCursor = anchor ? { id: anchor.id, startedAt: anchor.startedAt } : null;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      setWindowCursor(prev => (prev?.id === next?.id ? prev : next));
    }, 150);
  }, []);

  useEffect(
    () => (): void => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  // ── Single fetch helper ────────────────────────────────────────────────────
  const fetchPage = useCallback(
    (start: RecordingCursor) =>
      zero.run(queries.userRecordings({ limit: FETCH_LIMIT, start }), { type: 'complete' }),
    [zero],
  );

  const refresh = useCallback((): void => {
    void fetchPage(null)
      .then(page => {
        queryCacheActor.send({
          type: 'HYDRATE_RECORDINGS',
          data: {
            recordings: (page ?? []) as RecordingEntry[],
            hasMore: (page?.length ?? 0) === FETCH_LIMIT,
          },
        });
        setWindowCursor(null);
      })
      .catch(() => undefined);
  }, [fetchPage]);

  useEffect(() => {
    refreshListeners.add(refresh);
    return (): void => {
      refreshListeners.delete(refresh);
    };
  }, [refresh]);

  // ── loadMoreRecordings (forward — older recordings) ────────────────────────
  const loadMoreRecordings = useCallback(() => {
    if (isFetchingRef.current || !hasMoreRecordings) return;

    const last = recordingsRef.current.at(-1);
    if (!last) return;

    isFetchingRef.current = true;

    void (async (): Promise<void> => {
      try {
        const start = { id: last.id, startedAt: last.startedAt };
        const nextPage = await fetchPage(start);

        queryCacheActor.send({
          type: 'MERGE_RECORDINGS_PAGE',
          page: (nextPage ?? []) as RecordingEntry[],
          hasMore: (nextPage?.length ?? 0) === FETCH_LIMIT,
          start,
        });
      } finally {
        isFetchingRef.current = false;
      }
    })();
  }, [hasMoreRecordings, fetchPage]);

  return {
    recordings: accumulatedRecordings,
    hasMoreRecordings,
    loadMoreRecordings,
    onVisibleRangeChanged,
    isLoading: accumulatedRecordings.length === 0 && windowDetails.type === 'unknown',
  };
}
