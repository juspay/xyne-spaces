import { useRef, useEffect, useCallback } from 'react';
import { useSelector } from '@xstate/react';
import { QueryResultType } from '@rocicorp/zero';
import { queries } from '../zero/queries';
import { useCachedQuery } from './useCachedQuery';
import { queryCacheActor, type CallHistoryEntry } from '../machines/queryCacheMachine';
import { useZero } from './useZero';

type CallHistoryResult = QueryResultType<typeof queries.userCallHistoryV2>;
type CallHistoryCursor = { id: string; startedAt: number } | null;

const FETCH_LIMIT = 35;
const TRIGGER_THRESHOLD = 20;

interface UsePaginatedCallsOptions {
  enabled?: boolean;
}

interface UsePaginatedCallsReturn {
  calls: CallHistoryResult;
  hasMoreCalls: boolean;
  loadMoreCalls: () => void;
  onVisibleRangeChanged: (startIndex: number) => void;
  isLoading: boolean;
  queryDetails: ReturnType<typeof useCachedQuery>[1];
}

export function usePaginatedCalls(options: UsePaginatedCallsOptions = {}): UsePaginatedCallsReturn {
  const { enabled = true } = options;
  const zero = useZero();

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFetchingRef = useRef(false);

  // Accumulated state lives in queryCacheMachine (XState + IndexedDB) — survives unmount/remount
  const accumulatedCalls = useSelector(queryCacheActor, s => s.context.callHistory.calls);
  const hasMoreCalls = useSelector(queryCacheActor, s => s.context.callHistory.hasMore);
  const accumulatedCallsRef = useRef(accumulatedCalls);
  accumulatedCallsRef.current = accumulatedCalls;

  const [firstPage, queryDetails] = useCachedQuery(
    queries.userCallHistoryV2({ limit: FETCH_LIMIT, start: null }),
    { enabled },
  );

  useEffect(() => {
    if (!firstPage || queryDetails.type !== 'complete') return;
    queryCacheActor.send({
      type: 'MERGE_CALL_HISTORY_PAGE',
      page: firstPage as CallHistoryEntry[],
      hasMore: firstPage.length === FETCH_LIMIT,
    });
  }, [firstPage, queryDetails.type]);

  const fetchPage = useCallback(
    (start: CallHistoryCursor) =>
      zero.run(queries.userCallHistoryV2({ limit: FETCH_LIMIT, start }), { type: 'complete' }),
    [zero],
  );

  const loadMoreCalls = useCallback(() => {
    if (!enabled || isFetchingRef.current || !hasMoreCalls) return;

    const lastCall = accumulatedCallsRef.current.at(-1);
    if (!lastCall) return;

    isFetchingRef.current = true;

    void (async (): Promise<void> => {
      try {
        const start = { id: lastCall.id, startedAt: lastCall.startedAt };
        const nextPage = await fetchPage(start);

        queryCacheActor.send({
          type: 'MERGE_CALL_HISTORY_PAGE',
          page: (nextPage ?? []) as CallHistoryEntry[],
          hasMore: (nextPage?.length ?? 0) === FETCH_LIMIT,
        });
      } finally {
        isFetchingRef.current = false;
      }
    })();
  }, [enabled, fetchPage, hasMoreCalls]);

  const onVisibleRangeChanged = useCallback(
    (startIndex: number) => {
      const listLength = accumulatedCallsRef.current.length;
      if (listLength === 0 || startIndex + TRIGGER_THRESHOLD < listLength) return;

      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        loadMoreCalls();
      }, 150);
    },
    [loadMoreCalls],
  );

  useEffect(
    (): (() => void) => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  const isLoading = queryDetails.type !== 'complete' && accumulatedCalls.length === 0;

  return {
    calls: accumulatedCalls,
    hasMoreCalls,
    loadMoreCalls,
    onVisibleRangeChanged,
    isLoading,
    queryDetails,
  };
}
