import { useValue } from '@legendapp/state/react';
import { useSelector } from '@xstate/react';
import { useLayoutEffect, useMemo } from 'react';

import { useActivities } from '@/src/hooks/useActivities';
import { useAuth } from '@/src/contexts/AuthContext';
import { stateMachineActor } from '@/src/machines/appStateMachine';

import { filterCountsFrom, resolveActivityFilter, type ActivityFilter } from '../model/filter';
import { buildActivityRows, type ActivityRowData } from '../model/row';
import { createActivityRowContext } from '../model/row-context';
import { activityFilter$, setActivityFilterCounts } from '../state/filter-store';
import { syncActivityRows } from '../state/rows-store';

export type ActivityListMeta = {
  loadMore: () => void;
  hasMore: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  isEmpty: boolean;
  filter: ActivityFilter;
};

/**
 * Runs the shared activity model and pushes its result into the row store.
 *
 * The model is `useActivities` — the same fetch, snapshot cache, live query
 * and sync coordination the classic screen runs. Nothing about how activities
 * are loaded changes here; this hook only decides *which* slice to ask for
 * (from the chip) and what shape to hand the list.
 *
 * Users and channels are read once for the whole list. The classic row read
 * both from the app machine itself and built two lookup maps per row.
 *
 * `useLayoutEffect` rather than a write during render, for the reason the DMs
 * hook gives: the store is external state, and a render-phase write would be
 * visible to a render React later throws away.
 */
export function useActivityRows({ screenReady }: { screenReady: boolean }): ActivityListMeta {
  const filter = useValue(activityFilter$);
  const { tab, unreadOnly } = resolveActivityFilter(filter);
  const { user } = useAuth();
  const currentUserId = user?.user_id ?? '';
  const workspaceId = user?.workspaceId ?? null;

  const users = useSelector(stateMachineActor, state => state.context.users);
  const visibleChannels = useSelector(stateMachineActor, state => state.context.visibleChannels);

  const {
    activities,
    isLoading,
    loadMore,
    hasMore,
    isLoadingMore,
    setActiveTab,
    setShowUnreadOnly,
    activityCounts,
  } = useActivities({ screenReady });

  // The chip is the source of truth; the model is told which slice to load.
  // Layout timing so the request is made before the frame that would show the
  // previous chip's rows under the new chip's label.
  useLayoutEffect(() => {
    setActiveTab(tab);
    setShowUnreadOnly(unreadOnly);
  }, [setActiveTab, setShowUnreadOnly, tab, unreadOnly]);

  // The cache lives exactly as long as the context it was built under.
  const { context, cache } = useMemo(
    () => ({
      context: createActivityRowContext(users, visibleChannels, currentUserId),
      cache: new WeakMap<(typeof activities)[number], ActivityRowData | null>(),
    }),
    [currentUserId, users, visibleChannels],
  );

  const rows = useMemo(
    () => buildActivityRows(activities, context, cache),
    [activities, cache, context],
  );

  useLayoutEffect(() => {
    syncActivityRows(rows, workspaceId);
  }, [rows, workspaceId]);

  // Counts are of unread activities across the whole feed, not of the rows the
  // store holds.
  const counts = useMemo(() => filterCountsFrom(activityCounts), [activityCounts]);
  useLayoutEffect(() => {
    setActivityFilterCounts(counts);
  }, [counts]);

  return {
    loadMore,
    hasMore,
    isLoading,
    isLoadingMore,
    isEmpty: rows.length === 0,
    filter,
  };
}
