import { useRef, useEffect, useCallback } from 'react';
import { useSelector } from '@xstate/react';
import { QueryResultType } from '@rocicorp/zero';
import { queries } from '../zero/queries';
import { useCachedQuery } from './useCachedQuery';
import { queryCacheActor } from '../machines/queryCacheMachine';
import { useZero } from './useZero';

export type RecordingEntry = QueryResultType<typeof queries.userRecordings>[number];

const FETCH_LIMIT = 20;

interface UsePaginatedRecordingsReturn {
  recordings: RecordingEntry[];
  hasMoreRecordings: boolean;
  loadMoreRecordings: () => void;
  isLoading: boolean;
}

export function usePaginatedRecordings(): UsePaginatedRecordingsReturn {
  const zero = useZero();
  const isFetchingRef = useRef(false);

  // Accumulated state lives in queryCacheMachine (XState + IndexedDB) — survives unmount/remount
  const accumulatedRecordings = useSelector(queryCacheActor, s => s.context.recordings.recordings);
  const hasMoreRecordings = useSelector(queryCacheActor, s => s.context.recordings.hasMore);

  // Ref mirrors state so async callbacks always read current value without stale closures
  const recordingsRef = useRef(accumulatedRecordings);
  recordingsRef.current = accumulatedRecordings;

  // One permanent live query with null cursor — always syncs newest recordings
  const [page, queryDetails] = useCachedQuery(
    queries.userRecordings({ limit: FETCH_LIMIT, start: null }),
  );

  useEffect(() => {
    if (!page) return;
    queryCacheActor.send({
      type: 'MERGE_RECORDINGS_PAGE',
      page: page as RecordingEntry[],
      hasMore: page.length === FETCH_LIMIT,
      isFirstPage: true,
    });
  }, [page]);

  // ── Single fetch helper ────────────────────────────────────────────────────
  const fetchPage = useCallback(
    (start: { id: string; startedAt: number } | null) =>
      zero.run(queries.userRecordings({ limit: FETCH_LIMIT, start }), { type: 'complete' }),
    [zero],
  );

  // ── loadMoreRecordings (forward — older recordings) ────────────────────────
  const loadMoreRecordings = useCallback(() => {
    if (isFetchingRef.current || !hasMoreRecordings) return;

    const last = recordingsRef.current.at(-1);
    if (!last) return;

    isFetchingRef.current = true;

    void (async () => {
      try {
        const nextPage = await fetchPage({ id: last.id, startedAt: last.startedAt });

        if (!nextPage || nextPage.length === 0) {
          queryCacheActor.send({ type: 'MERGE_RECORDINGS_PAGE', page: [], hasMore: false });
          return;
        }

        queryCacheActor.send({
          type: 'MERGE_RECORDINGS_PAGE',
          page: nextPage as RecordingEntry[],
          hasMore: nextPage.length === FETCH_LIMIT,
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
    isLoading: queryDetails.type === 'unknown',
  };
}
