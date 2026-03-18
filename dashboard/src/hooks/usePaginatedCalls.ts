import { useState, useRef, useEffect } from 'react';
import { QueryResultType } from '@rocicorp/zero';
import { queries } from '../zero/queries';
import { useCachedQuery } from './useCachedQuery';

type CallHistoryResult = QueryResultType<typeof queries.userCallHistory>;

const PAGE_SIZE = 25;

interface UsePaginatedCallsOptions {
  enabled?: boolean;
}

interface UsePaginatedCallsReturn {
  calls: CallHistoryResult;
  hasMoreCalls: boolean;
  loadMoreCalls: () => void;
  isLoading: boolean;
}

export function usePaginatedCalls(options: UsePaginatedCallsOptions = {}): UsePaginatedCallsReturn {
  const { enabled = true } = options;

  const [cursor, setCursor] = useState<{ id: string; startedAt: number } | null>(null);
  const [accumulatedCalls, setAccumulatedCalls] = useState<CallHistoryResult>([]);
  const [hasMoreCalls, setHasMoreCalls] = useState(false);

  const [newPage, queryDetails] = useCachedQuery(
    queries.userCallHistory({ limit: PAGE_SIZE, start: cursor }),
    { enabled },
  );

  // Track cursor changes to accumulate calls
  const prevCursorRef = useRef<string | null>('__unset__');
  const cursorKey = cursor ? `${cursor.id}:${cursor.startedAt}` : null;

  useEffect(() => {
    if (!newPage) return;
    if (prevCursorRef.current === cursorKey) return;
    prevCursorRef.current = cursorKey;

    setHasMoreCalls(newPage.length === PAGE_SIZE);
    setAccumulatedCalls(prev => {
      return cursorKey === null ? newPage : [...prev, ...newPage];
    });
  }, [cursorKey, newPage]);

  const loadMoreCalls = () => {
    if (!hasMoreCalls || accumulatedCalls.length === 0) return;
    const lastCall = accumulatedCalls[accumulatedCalls.length - 1];
    if (lastCall) {
      setCursor({ id: lastCall.id, startedAt: lastCall.startedAt });
    }
  };

  const isLoading = queryDetails.type !== 'complete' && accumulatedCalls.length === 0;

  return {
    calls: accumulatedCalls,
    hasMoreCalls,
    loadMoreCalls,
    isLoading,
  };
}
