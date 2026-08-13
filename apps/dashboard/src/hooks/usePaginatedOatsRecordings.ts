import { useCallback, useEffect, useRef, useState } from 'react';
import type { QueryResultType } from '@rocicorp/zero';
import { queries } from '../zero/queries';
import { useCachedQuery } from './useCachedQuery';
import { useZero } from './useZero';

export type OatsRecordingScope = 'created' | 'shared';
export type OatsRecordingEntry = QueryResultType<typeof queries.createdOatsRecordings>[number];

const FETCH_LIMIT = 20;

const refreshListeners = new Set<() => void>();

/**
 * Refetch every mounted Oats list from the server.
 */
export function refreshOatsRecordings(): void {
  for (const listener of refreshListeners) listener();
}
type RecordingCursor = { id: string; startedAt: number } | null;
type OatsRecordingQuery =
  | ReturnType<typeof queries.createdOatsRecordings>
  | ReturnType<typeof queries.sharedOatsRecordings>;

const recordingQuery = (scope: OatsRecordingScope, start: RecordingCursor): OatsRecordingQuery =>
  scope === 'created'
    ? queries.createdOatsRecordings({ limit: FETCH_LIMIT, start })
    : queries.sharedOatsRecordings({ limit: FETCH_LIMIT, start });

export interface UsePaginatedOatsRecordingsReturn {
  recordings: OatsRecordingEntry[];
  hasMoreRecordings: boolean;
  loadMoreRecordings: () => void;
  onVisibleRangeChanged: (startIndex: number) => void;
  isLoading: boolean;
  error: string | null;
  refreshRecordings: () => void;
}

export function usePaginatedOatsRecordings(
  scope: OatsRecordingScope,
): UsePaginatedOatsRecordingsReturn {
  const zero = useZero();
  const [cursor, setCursor] = useState<RecordingCursor>(null);
  const [recordings, setRecordings] = useState<OatsRecordingEntry[]>([]);
  const [hasMoreRecordings, setHasMoreRecordings] = useState(true);
  const recordingsRef = useRef(recordings);
  recordingsRef.current = recordings;

  const [page, details] = useCachedQuery(recordingQuery(scope, cursor), {
    cursorEnabled: true,
  });

  useEffect(() => {
    setCursor(null);
    setRecordings([]);
    setHasMoreRecordings(true);
  }, [scope]);

  useEffect(() => {
    if (!page || details.type !== 'complete') return;

    setRecordings(current => {
      const rows = cursor ? [...current, ...page] : [...page];
      return [...new Map(rows.map(recording => [recording.id, recording] as const)).values()];
    });
    setHasMoreRecordings(page.length === FETCH_LIMIT);
  }, [cursor, details.type, page]);

  const loadMoreRecordings = useCallback((): void => {
    if (!hasMoreRecordings) return;
    const last = recordingsRef.current.at(-1);
    if (!last) return;
    setCursor({ id: last.id, startedAt: last.startedAt });
  }, [hasMoreRecordings]);

  const refreshRecordings = useCallback((): void => {
    setCursor(null);
    void zero
      .run(recordingQuery(scope, null), { type: 'complete' })
      .then(result => {
        setRecordings((result ?? []) as OatsRecordingEntry[]);
        setHasMoreRecordings((result?.length ?? 0) === FETCH_LIMIT);
      })
      .catch(() => undefined);
  }, [scope, zero]);

  useEffect(() => {
    refreshListeners.add(refreshRecordings);
    return (): void => {
      refreshListeners.delete(refreshRecordings);
    };
  }, [refreshRecordings]);

  return {
    recordings,
    hasMoreRecordings,
    loadMoreRecordings,
    onVisibleRangeChanged: () => undefined,
    isLoading: recordings.length === 0 && details.type === 'unknown',
    error: null,
    refreshRecordings,
  };
}
