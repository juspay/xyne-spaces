import { useCallback, useEffect, useRef, useState } from 'react';
import type { QueryResultType } from '@rocicorp/zero';
import { queries } from '../zero/queries';
import { useCachedQuery } from './useCachedQuery';
import { useZero } from './useZero';

export type OatsRecordingScope = 'all' | 'created' | 'shared';
export type OatsRecordingEntry = QueryResultType<typeof queries.createdOatsRecordings>[number];

const FETCH_LIMIT = 20;

const refreshListeners = new Set<() => void>();

/**
 * Refetch every mounted Oats list from the server.
 */
export function refreshOatsRecordings(): void {
  for (const listener of refreshListeners) listener();
}

type LabelsPatchListener = (recordingId: string, labels: string[]) => void;
const labelsPatchListeners = new Set<LabelsPatchListener>();

/** Patch one recording's labels in every mounted list in place, without a full refetch. */
export function patchOatsRecordingLabels(recordingId: string, labels: string[]): void {
  for (const listener of labelsPatchListeners) listener(recordingId, labels);
}
type RecordingCursor = { id: string; startedAt: number } | null;
type SingleOatsRecordingScope = Exclude<OatsRecordingScope, 'all'>;
type OatsRecordingQuery =
  | ReturnType<typeof queries.createdOatsRecordings>
  | ReturnType<typeof queries.sharedOatsRecordings>;

const recordingQuery = (
  scope: SingleOatsRecordingScope,
  start: RecordingCursor,
  participantId: string | null,
): OatsRecordingQuery =>
  scope === 'created'
    ? queries.createdOatsRecordings({ limit: FETCH_LIMIT, start, participantId })
    : queries.sharedOatsRecordings({ limit: FETCH_LIMIT, start, participantId });

const mergeRecordingPages = (
  current: OatsRecordingEntry[],
  ...pages: Array<readonly OatsRecordingEntry[] | null | undefined>
): OatsRecordingEntry[] => {
  const byId = new Map<string, OatsRecordingEntry>();
  for (const recording of current) byId.set(recording.id, recording);
  for (const page of pages) {
    if (!page) continue;
    for (const recording of page) byId.set(recording.id, recording);
  }
  return Array.from(byId.values()).sort(
    (left, right) => right.startedAt - left.startedAt || right.id.localeCompare(left.id),
  );
};

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
  participantId: string | null,
): UsePaginatedOatsRecordingsReturn {
  const zero = useZero();
  const isAllScope = scope === 'all';
  const queryScope: SingleOatsRecordingScope = scope === 'shared' ? 'shared' : 'created';
  const [cursor, setCursor] = useState<RecordingCursor>(null);
  const [sharedCursor, setSharedCursor] = useState<RecordingCursor>(null);
  const [recordings, setRecordings] = useState<OatsRecordingEntry[]>([]);
  const [hasMoreRecordings, setHasMoreRecordings] = useState(true);
  const [hasMoreSharedRecordings, setHasMoreSharedRecordings] = useState(true);
  const recordingsRef = useRef(recordings);
  recordingsRef.current = recordings;

  const [page, details] = useCachedQuery(recordingQuery(queryScope, cursor, participantId));
  const [sharedPage, sharedDetails] = useCachedQuery(
    queries.sharedOatsRecordings({ limit: FETCH_LIMIT, start: sharedCursor, participantId }),
    { enabled: isAllScope },
  );

  useEffect(() => {
    setCursor(null);
    setSharedCursor(null);
    setRecordings([]);
    setHasMoreRecordings(true);
    setHasMoreSharedRecordings(true);
  }, [scope, participantId]);

  useEffect(() => {
    if (!page || details.type !== 'complete') return;

    if (isAllScope) {
      setRecordings(current => mergeRecordingPages(current, page));
      setHasMoreRecordings(page.length === FETCH_LIMIT);
      return;
    }

    setRecordings(current => {
      const rows = cursor ? [...current, ...page] : [...page];
      return [...new Map(rows.map(recording => [recording.id, recording] as const)).values()];
    });
    setHasMoreRecordings(page.length === FETCH_LIMIT);
  }, [cursor, details.type, isAllScope, page]);

  useEffect(() => {
    if (!isAllScope || !sharedPage || sharedDetails.type !== 'complete') return;

    setRecordings(current => mergeRecordingPages(current, sharedPage));
    setHasMoreSharedRecordings(sharedPage.length === FETCH_LIMIT);
  }, [isAllScope, sharedDetails.type, sharedPage]);

  const loadMoreRecordings = useCallback((): void => {
    if (isAllScope) {
      const currentUserId = zero.context.userID;
      let nextCreatedCursor: RecordingCursor = null;
      let nextSharedCursor: RecordingCursor = null;

      for (let index = recordingsRef.current.length - 1; index >= 0; index -= 1) {
        const recording = recordingsRef.current[index];
        if (!recording) continue;

        if (!nextCreatedCursor && recording.createdByUserId === currentUserId) {
          nextCreatedCursor = { id: recording.id, startedAt: recording.startedAt };
        }
        if (!nextSharedCursor && recording.createdByUserId !== currentUserId) {
          nextSharedCursor = { id: recording.id, startedAt: recording.startedAt };
        }
        if (
          (!hasMoreRecordings || nextCreatedCursor) &&
          (!hasMoreSharedRecordings || nextSharedCursor)
        ) {
          break;
        }
      }

      if (hasMoreRecordings && nextCreatedCursor) setCursor(nextCreatedCursor);
      if (hasMoreSharedRecordings && nextSharedCursor) setSharedCursor(nextSharedCursor);
      return;
    }

    if (!hasMoreRecordings) return;
    const last = recordingsRef.current.at(-1);
    if (!last) return;
    setCursor({ id: last.id, startedAt: last.startedAt });
  }, [hasMoreRecordings, hasMoreSharedRecordings, isAllScope, zero.context.userID]);

  const refreshRecordings = useCallback((): void => {
    setCursor(null);
    if (isAllScope) {
      setSharedCursor(null);
      void Promise.all([
        zero.run(recordingQuery('created', null, participantId), { type: 'complete' }),
        zero.run(recordingQuery('shared', null, participantId), { type: 'complete' }),
      ])
        .then(([createdResult, sharedResult]) => {
          const createdRows = (createdResult ?? []) as OatsRecordingEntry[];
          const sharedRows = (sharedResult ?? []) as OatsRecordingEntry[];
          setRecordings(mergeRecordingPages([], createdRows, sharedRows));
          setHasMoreRecordings(createdRows.length === FETCH_LIMIT);
          setHasMoreSharedRecordings(sharedRows.length === FETCH_LIMIT);
        })
        .catch(() => undefined);
      return;
    }

    void zero
      .run(recordingQuery(queryScope, null, participantId), { type: 'complete' })
      .then(result => {
        setRecordings((result ?? []) as OatsRecordingEntry[]);
        setHasMoreRecordings((result?.length ?? 0) === FETCH_LIMIT);
      })
      .catch(() => undefined);
  }, [isAllScope, participantId, queryScope, zero]);

  useEffect(() => {
    refreshListeners.add(refreshRecordings);
    return (): void => {
      refreshListeners.delete(refreshRecordings);
    };
  }, [refreshRecordings]);

  // Patches one row's labels in place so a label action doesn't force
  // the full-list refetch that resets scroll position and pagination
  useEffect(() => {
    const listener: LabelsPatchListener = (recordingId, labels) => {
      setRecordings(current =>
        current.map(recording =>
          recording.id === recordingId ? { ...recording, labels } : recording,
        ),
      );
    };
    labelsPatchListeners.add(listener);
    return (): void => {
      labelsPatchListeners.delete(listener);
    };
  }, []);

  const hasMoreForScope = isAllScope
    ? hasMoreRecordings || hasMoreSharedRecordings
    : hasMoreRecordings;
  const isLoadingForScope = isAllScope
    ? recordings.length === 0 && (details.type === 'unknown' || sharedDetails.type === 'unknown')
    : recordings.length === 0 && details.type === 'unknown';

  return {
    recordings,
    hasMoreRecordings: hasMoreForScope,
    loadMoreRecordings,
    onVisibleRangeChanged: () => undefined,
    isLoading: isLoadingForScope,
    error: null,
    refreshRecordings,
  };
}
