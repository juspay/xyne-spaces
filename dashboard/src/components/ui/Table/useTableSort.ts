import { useState, useMemo, useCallback } from 'react';
import type { SortState, SortDirection } from './Table.types';

interface UseTableSortOptions {
  defaultSort?: SortState | undefined;
  controlledSort?: SortState | undefined;
  onSortChange?: ((sort: SortState) => void) | undefined;
}

interface UseTableSortResult<TData> {
  sortedData: TData[];
  currentSort: SortState;
  handleSortChange: (field: string) => void;
}

function getNextDirection(current: SortDirection): SortDirection {
  if (current === null) return 'asc';
  if (current === 'asc') return 'desc';
  return null;
}

function compareValues(a: unknown, b: unknown): number {
  if (a === null && b === null) return 0;
  if (a === undefined && b === undefined) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;

  if (typeof a === 'number' && typeof b === 'number') {
    return a - b;
  }

  const strA = typeof a === 'string' ? a : JSON.stringify(a);
  const strB = typeof b === 'string' ? b : JSON.stringify(b);
  return strA.localeCompare(strB);
}

export function useTableSort<TData extends Record<string, unknown>>(
  data: TData[],
  options: UseTableSortOptions,
): UseTableSortResult<TData> {
  const { defaultSort, controlledSort, onSortChange } = options;
  const isControlled = controlledSort !== undefined && onSortChange !== undefined;

  const [internalSort, setInternalSort] = useState<SortState>(
    defaultSort ?? { field: '', direction: null },
  );

  const currentSort = isControlled ? controlledSort : internalSort;

  const handleSortChange = useCallback(
    (field: string) => {
      const nextDirection =
        currentSort.field === field ? getNextDirection(currentSort.direction) : 'asc';

      const newSort: SortState = { field, direction: nextDirection };

      if (isControlled) {
        onSortChange(newSort);
      } else {
        setInternalSort(newSort);
      }
    },
    [currentSort, isControlled, onSortChange],
  );

  const sortedData = useMemo(() => {
    // Server-side sorting: don't touch data
    if (isControlled) return data;

    const { field, direction } = currentSort;
    if (!field || !direction) return data;

    return [...data].sort((a, b) => {
      const result = compareValues(a[field], b[field]);
      return direction === 'asc' ? result : -result;
    });
  }, [data, currentSort, isControlled]);

  return { sortedData, currentSort, handleSortChange };
}
