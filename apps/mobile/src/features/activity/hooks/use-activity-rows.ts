import { useValue } from '@legendapp/state/react';
import { useSelector } from '@xstate/react';
import { useLayoutEffect, useMemo } from 'react';

import { useActivities } from '@/src/hooks/useActivities';
import { useAuth } from '@/src/contexts/AuthContext';
import { stateMachineActor } from '@/src/machines/appStateMachine';

import { filterCountsFrom, type ActivityFilter } from '../model/filter';
import { actorFilterFrom } from '../model/preferences';
import { buildActivityRows, type ActivityRowData } from '../model/row';
import { createActivityRowContext } from '../model/row-context';
import { activityFilter$, setActivityFilterCounts } from '../state/filter-store';
import { appliedActivityPreferences$ } from '../state/preferences-store';
import { syncActivityRows } from '../state/rows-store';

/**
 * The flipped copy of a row, remembered. A row whose tint disagrees with the
 * live unread set is replaced by one object that agrees, and the same object
 * is handed back every time, so the store's identity check still sees "no
 * change" for a row that is merely still stale.
 */
const flippedRows = new WeakMap<ActivityRowData, ActivityRowData>();

/**
 * Takes each row's unread state from the live unread set where there is one.
 *
 * The rows come from a paged list whose later pages are never re-delivered, so
 * their own `isUnread` goes stale as soon as something is read elsewhere —
 * "Mark as read", the dashboard, another device. The unread set is a live
 * query of every unread activity and does not.
 */
function withLiveReadState(
  rows: readonly ActivityRowData[],
  unreadIds: ReadonlySet<string> | undefined,
): readonly ActivityRowData[] {
  if (unreadIds === undefined) return rows;
  return rows.map(row => {
    if (unreadIds.has(row.id) === row.isUnread) return row;
    let flipped = flippedRows.get(row);
    if (flipped === undefined) {
      flipped = { ...row, isUnread: !row.isUnread };
      flippedRows.set(row, flipped);
    }
    return flipped;
  });
}

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
  // The applied preferences, not the draft the tray is editing: the feed only
  // hears about a change once the control that made it has settled.
  const filter = useValue(activityFilter$);
  const unreadOnly = useValue(appliedActivityPreferences$.unreadOnly);
  const actorKind = useValue(appliedActivityPreferences$.actorKind);
  const actorUserId = useValue(appliedActivityPreferences$.actorUserId);
  // A chip is a tab of the shared model, one to one.
  const tab = filter;
  const { user } = useAuth();
  const currentUserId = user?.user_id ?? '';
  const workspaceId = user?.workspaceId ?? null;

  const users = useSelector(stateMachineActor, state => state.context.users);
  const visibleChannels = useSelector(stateMachineActor, state => state.context.visibleChannels);

  const actor = useMemo(
    () => actorFilterFrom({ actorKind, actorUserId }),
    [actorKind, actorUserId],
  );

  const {
    activities,
    isLoading,
    loadMore,
    hasMore,
    isLoadingMore,
    setActiveTab,
    setShowUnreadOnly,
    activityCounts,
    unreadActivityIds,
  } = useActivities({ screenReady, actor });

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
    () => withLiveReadState(buildActivityRows(activities, context, cache), unreadActivityIds),
    [activities, cache, context, unreadActivityIds],
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
