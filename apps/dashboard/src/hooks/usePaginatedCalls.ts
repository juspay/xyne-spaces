import { useRef, useEffect, useCallback, useMemo } from 'react';
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
  participantOnly?: boolean;
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
  const { enabled = true, participantOnly = false } = options;
  const zero = useZero();

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFetchingRef = useRef(false);

  // Select the appropriate cache bucket based on participantOnly flag
  const accumulatedCalls = useSelector(queryCacheActor, s =>
    participantOnly ? s.context.callHistoryParticipantOnly.calls : s.context.callHistory.calls,
  );
  const hasMoreCalls = useSelector(queryCacheActor, s =>
    participantOnly ? s.context.callHistoryParticipantOnly.hasMore : s.context.callHistory.hasMore,
  );
  const accumulatedCallsRef = useRef(accumulatedCalls);
  accumulatedCallsRef.current = accumulatedCalls;

  // Select the appropriate query based on participantOnly flag
  const firstPageQuery = useMemo(
    () =>
      participantOnly
        ? queries.userCallHistoryParticipantOnly({ limit: FETCH_LIMIT, start: null })
        : queries.userCallHistoryV2({ limit: FETCH_LIMIT, start: null }),
    [participantOnly],
  );

  const [firstPage, queryDetails] = useCachedQuery(firstPageQuery, { enabled });

  useEffect(() => {
    if (!firstPage || queryDetails.type !== 'complete') return;
    queryCacheActor.send({
      type: participantOnly
        ? 'MERGE_CALL_HISTORY_PARTICIPANT_ONLY_PAGE'
        : 'MERGE_CALL_HISTORY_PAGE',
      page: firstPage as CallHistoryEntry[],
      hasMore: firstPage.length === FETCH_LIMIT,
    });
  }, [firstPage, queryDetails.type, participantOnly]);

  const fetchPage = useCallback(
    (start: CallHistoryCursor) =>
      participantOnly
        ? zero.run(queries.userCallHistoryParticipantOnly({ limit: FETCH_LIMIT, start }), {
            type: 'complete',
          })
        : zero.run(queries.userCallHistoryV2({ limit: FETCH_LIMIT, start }), { type: 'complete' }),
    [zero, participantOnly],
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
          type: participantOnly
            ? 'MERGE_CALL_HISTORY_PARTICIPANT_ONLY_PAGE'
            : 'MERGE_CALL_HISTORY_PAGE',
          page: (nextPage ?? []) as CallHistoryEntry[],
          hasMore: (nextPage?.length ?? 0) === FETCH_LIMIT,
        });
      } finally {
        isFetchingRef.current = false;
      }
    })();
  }, [enabled, fetchPage, hasMoreCalls, participantOnly]);

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
