import { useState, useRef, useEffect, useCallback } from 'react';
import { useSelector } from '@xstate/react';
import { QueryResultType } from '@rocicorp/zero';
import { queries } from '../zero/queries';
import { useCachedQuery } from './useCachedQuery';
import { queryCacheActor, type CallHistoryEntry } from '../machines/queryCacheMachine';

type CallHistoryResult = QueryResultType<typeof queries.userCallHistory>;

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
}

export function usePaginatedCalls(options: UsePaginatedCallsOptions = {}): UsePaginatedCallsReturn {
  const { enabled = true } = options;

  const [cursor, setCursor] = useState<{ id: string; startedAt: number } | null>(null);
  const cursorIndexRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Accumulated state lives in queryCacheMachine (XState + IndexedDB) — survives unmount/remount
  const accumulatedCalls = useSelector(queryCacheActor, s => s.context.callHistory.calls);
  const hasMoreCalls = useSelector(queryCacheActor, s => s.context.callHistory.hasMore);

  const [page, queryDetails] = useCachedQuery(
    queries.userCallHistory({ limit: FETCH_LIMIT, start: cursor }),
    { enabled },
  );

  useEffect(() => {
    if (!page) return;
    queryCacheActor.send({
      type: 'MERGE_CALL_HISTORY_PAGE',
      page: page as CallHistoryEntry[],
      hasMore: page.length === FETCH_LIMIT,
    });
  }, [page]);

  const onVisibleRangeChanged = useCallback(
    (startIndex: number) => {
      if (accumulatedCalls.length === 0) return;

      const windowStart = cursorIndexRef.current;
      const windowEnd = windowStart + FETCH_LIMIT;
      let nextIdx: number | undefined;
      let nextCursor: { id: string; startedAt: number } | null | undefined;

      if (startIndex + TRIGGER_THRESHOLD >= windowEnd && windowEnd < accumulatedCalls.length) {
        nextIdx = Math.min(windowStart + TRIGGER_THRESHOLD, accumulatedCalls.length - 1);
        const call = accumulatedCalls[nextIdx];
        if (call) nextCursor = { id: call.id, startedAt: call.startedAt };
      } else if (startIndex < windowStart + TRIGGER_THRESHOLD && windowStart > 0) {
        nextIdx = Math.max(windowStart - TRIGGER_THRESHOLD, 0);
        if (nextIdx === 0) {
          nextCursor = null;
        } else {
          const call = accumulatedCalls[nextIdx];
          if (call) nextCursor = { id: call.id, startedAt: call.startedAt };
        }
      }

      if (nextCursor === undefined && nextIdx === undefined) return;

      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        cursorIndexRef.current = nextIdx!;
        setCursor(nextCursor!);
      }, 150);
    },
    [accumulatedCalls],
  );

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  const loadMoreCalls = useCallback(() => {
    if (!hasMoreCalls || accumulatedCalls.length === 0) return;
    const lastCall = accumulatedCalls[accumulatedCalls.length - 1];
    if (lastCall) {
      cursorIndexRef.current = accumulatedCalls.length;
      setCursor({ id: lastCall.id, startedAt: lastCall.startedAt });
    }
  }, [hasMoreCalls, accumulatedCalls]);

  const isLoading = queryDetails.type !== 'complete' && accumulatedCalls.length === 0;

  return { calls: accumulatedCalls, hasMoreCalls, loadMoreCalls, onVisibleRangeChanged, isLoading };
}
