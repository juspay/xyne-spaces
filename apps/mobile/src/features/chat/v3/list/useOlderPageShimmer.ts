import { useCallback, useState } from 'react';

/** `undefined` = idle. Otherwise waiting for this oldest row to be replaced. */
export const isOlderPageShimmerVisible = (
  waitingForId: string | null | undefined,
  oldestRowId: string | null,
  hasReachedStart: boolean,
): boolean => waitingForId !== undefined && waitingForId === oldestRowId && !hasReachedStart;

/**
 * Header shimmer until older rows prepend or the history start is reached.
 * Clears during render when those inputs change — not in an Effect.
 */
export const useOlderPageShimmer = (
  hasReachedStart: boolean,
  oldestRowId: string | null,
): { showShimmer: boolean; noteOlderRequested: () => void } => {
  const [waitingForId, setWaitingForId] = useState<string | null | undefined>(undefined);

  if (waitingForId !== undefined && (hasReachedStart || waitingForId !== oldestRowId)) {
    setWaitingForId(undefined);
  }

  const noteOlderRequested = useCallback((): void => {
    setWaitingForId(current => {
      if (hasReachedStart || current !== undefined) {
        return current;
      }
      return oldestRowId;
    });
  }, [hasReachedStart, oldestRowId]);

  return {
    showShimmer: isOlderPageShimmerVisible(waitingForId, oldestRowId, hasReachedStart),
    noteOlderRequested,
  };
};
