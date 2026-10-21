import { useCallback, useRef } from 'react';

import { heightViolationFor, recordHeightViolation } from '../observability/heightViolation';
import type { ChatRow } from '../model/chatRow.types';
import { keyExtractor } from '../model/rowType';

type ListState = {
  data: readonly unknown[];
  start: number;
  end: number;
};

type ListRef = { current: { getState: () => ListState | undefined } | null };

export const useHeightViolation = (
  listRef: ListRef,
  dataKey: string,
): ((info: { size: number; itemKey: string }) => void) => {
  const previousSizeByIdRef = useRef(new Map<string, number>());
  const dataKeyRef = useRef(dataKey);
  if (dataKeyRef.current !== dataKey) {
    dataKeyRef.current = dataKey;
    previousSizeByIdRef.current = new Map();
  }
  return useCallback(
    ({ size, itemKey }: { size: number; itemKey: string }): void => {
      const viewport = listRef.current?.getState();
      const visibleIds = new Set<string>();
      if (viewport) {
        const data = viewport.data as readonly ChatRow[];
        for (let index = viewport.start; index <= viewport.end; index += 1) {
          const row = data[index];
          if (row) {
            visibleIds.add(keyExtractor(row));
          }
        }
      }
      recordHeightViolation(
        heightViolationFor(itemKey, size, visibleIds, previousSizeByIdRef.current),
      );
      previousSizeByIdRef.current.set(itemKey, size);
    },
    [listRef],
  );
};
