import { useValue } from '@legendapp/state/react';
import { useLayoutEffect } from 'react';

import { useAuth } from '@/src/contexts/AuthContext';
import { useDmList } from '@/src/hooks/useDmList';

import { dmFilter$, setDmFilterCounts } from '../state/filter-store';
import { syncDmRows } from '../state/rows-store';

export type DmListMeta = {
  loadMore: () => void;
  hasMore: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  hasLoadError: boolean;
  isEmpty: boolean;
  isFiltering: boolean;
  unreadDmCount: number;
};

/**
 * Runs the shared DM query and pushes its result into row store.
 *
 * `liveDataEnabled` is left at its default. The classic screen defers
 * the subscription behind `useDeferredLiveData` and a global
 * interaction latch; for this screen that machinery is inherited
 * complexity - after its first activation the latch cannot affect this
 * screen again, and the deferral buys startup time this screen should
 * not need. Measure before adding it back, and add it here rather than
 * in the view.
 *
 * `useLayoutEffect`, not a write during render: the store is external
 * state, and a render-phase write would be visible to a render React
 * later throws away. Layout timing means the rows are in the store
 * before paint, so the extra pass costs no frame.
 */

export function useDmRows(): DmListMeta {
  const filterTab = useValue(dmFilter$);
  const { user } = useAuth();
  const workspaceId = user?.workspaceId ?? null;

  const {
    items,
    loadMore,
    hasMore,
    isLoading,
    isLoadingMore,
    hasLoadError,
    isEmpty,
    isFiltering,
    unreadDmCount,
    filterCounts,
  } = useDmList({ filterTab });

  useLayoutEffect(() => {
    syncDmRows(items, workspaceId);
  }, [items, workspaceId]);

  // Alongside the rows rather than inside `syncDmRows`: the counts are
  // derived from the unfiltered list, so they are not a property of the rows
  // the store holds.
  useLayoutEffect(() => {
    setDmFilterCounts(filterCounts);
  }, [filterCounts]);

  return {
    loadMore,
    hasMore,
    isLoading,
    isLoadingMore,
    hasLoadError,
    isEmpty,
    isFiltering,
    unreadDmCount,
  };
}
