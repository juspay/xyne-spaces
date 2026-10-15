import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { LegendListRef } from '@legendapp/list/react-native';

/**
 * Paint vs load: `onLoad` is not "the user can see a row".
 * Drop the skeleton from `onFirstVisibleItemChanged` only.
 */
export const useListLayoutReadiness = ({
  listRef,
  dataKey,
  rowCount,
  syncViewport,
}: {
  listRef: RefObject<LegendListRef | null>;
  dataKey: string;
  rowCount: number;
  syncViewport: () => boolean;
}): {
  listLayoutReady: boolean;
  markListLayoutReady: () => void;
  onListLoad: (info: { elapsedTimeInMs: number }) => void;
} => {
  const [paintedDataKey, setPaintedDataKey] = useState<string | null>(null);
  const listLoadFrameRef = useRef<number | null>(null);
  const listLayoutReady = rowCount > 0 && paintedDataKey === dataKey;

  const markListLayoutReady = useCallback((): void => {
    if (rowCount > 0) {
      setPaintedDataKey(current => (current === dataKey ? current : dataKey));
    }
  }, [dataKey, rowCount]);

  const onListLoad = useCallback(
    (_info: { elapsedTimeInMs: number }): void => {
      if (rowCount === 0 || syncViewport()) {
        return;
      }
      if (listLoadFrameRef.current !== null) {
        cancelAnimationFrame(listLoadFrameRef.current);
      }
      listLoadFrameRef.current = requestAnimationFrame((): void => {
        listLoadFrameRef.current = null;
        syncViewport();
      });
    },
    [rowCount, syncViewport],
  );

  useEffect(() => {
    const unsubscribe = listRef.current?.getState()?.listen('readyToRender', ready => {
      if (ready) {
        syncViewport();
      }
    });
    return (): void => {
      unsubscribe?.();
      if (listLoadFrameRef.current !== null) {
        cancelAnimationFrame(listLoadFrameRef.current);
      }
    };
  }, [dataKey, listRef, rowCount, syncViewport]);

  return { listLayoutReady, markListLayoutReady, onListLoad };
};
