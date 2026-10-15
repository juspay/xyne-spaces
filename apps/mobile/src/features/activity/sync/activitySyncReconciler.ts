import { ActivityClassification } from '@xyne/shared';

import { useZero } from '@/src/hooks/useZero';
import { queries } from '@/src/zero/queries';
import { buildUserActivitiesPaginatedV2Query } from '@/src/features/activity/domain/activityPaginatedQuery';
import {
  selectActivitiesForWorkspace,
  selectVisibleActivities,
} from '@/src/features/activity/domain/activitySelectors';
import type { ActivityLike, ActivityTab } from '@/src/features/activity/domain/activityTypes';
import type { ActivityCursor } from '@/src/utils/activitySnapshotCache';
import type { ActivityWithRelated } from '@/src/types/activity';

const COMPLETE_QUERY_OPTIONS = { type: 'complete' } as const;

type ZeroRunner = ReturnType<typeof useZero>;

type ReconcileUnreadActivitiesArgs = {
  zero: ZeroRunner;
  currentUserId: string;
  workspaceId: string;
  refreshNonce: number;
};

const getActivityCursor = <
  TActivity extends { id: string; updatedAt?: number | null; createdAt: number },
>(
  activity: TActivity | undefined,
): ActivityCursor | null =>
  activity
    ? {
        id: activity.id,
        updatedAt: activity.updatedAt ?? activity.createdAt,
      }
    : null;

type ReconcileActivityFirstPageArgs = ReconcileUnreadActivitiesArgs & {
  activeTab: ActivityTab;
  showUnreadOnly: boolean;
  currentTypes: string[];
  classificationFilter: ActivityClassification[] | undefined;
  pageSize: number;
  resolveDisplayPage: (
    rawPage: ActivityWithRelated[],
    rawNextCursor: ActivityCursor | null,
    rawHasMore: boolean,
  ) => Promise<{
    rows: ActivityWithRelated[];
    nextCursor: ActivityCursor | null;
    hasMore: boolean;
    queryRowCount: number;
  }>;
};

export type ActivityFirstPageReconcileResult = {
  rows: ActivityWithRelated[];
  nextCursor: ActivityCursor | null;
  hasMore: boolean;
  queryRowCount: number;
  unreadActivities: readonly ActivityLike[];
};

const unreadActivitiesInFlight = new Map<string, Promise<readonly ActivityLike[]>>();
const firstPageInFlight = new Map<string, Promise<ActivityFirstPageReconcileResult>>();

const withSharedPromise = <TValue>(
  cache: Map<string, Promise<TValue>>,
  key: string,
  factory: () => Promise<TValue>,
): Promise<TValue> => {
  const existing = cache.get(key);
  if (existing) {
    return existing;
  }

  const promise = factory().finally(() => {
    cache.delete(key);
  });
  cache.set(key, promise);
  return promise;
};

export const reconcileUnreadActivities = ({
  zero,
  currentUserId,
  workspaceId,
  refreshNonce,
}: ReconcileUnreadActivitiesArgs): Promise<readonly ActivityLike[]> => {
  const cacheKey = `${currentUserId}:${workspaceId}:${refreshNonce}:unread`;

  return withSharedPromise(unreadActivitiesInFlight, cacheKey, async () => {
    const activities = await zero.run(queries.userUnreadActivities(), COMPLETE_QUERY_OPTIONS);
    return selectActivitiesForWorkspace(
      activities as readonly ActivityLike[] | undefined,
      workspaceId,
    );
  });
};

export const reconcileActivityFirstPage = ({
  zero,
  currentUserId,
  workspaceId,
  refreshNonce,
  activeTab,
  showUnreadOnly,
  currentTypes,
  classificationFilter,
  pageSize,
  resolveDisplayPage,
}: ReconcileActivityFirstPageArgs): Promise<ActivityFirstPageReconcileResult> => {
  const cacheKey = [
    currentUserId,
    workspaceId,
    refreshNonce,
    activeTab,
    showUnreadOnly ? 'unread' : 'all',
    currentTypes.join(','),
    classificationFilter?.join(',') ?? 'none',
  ].join(':');

  return withSharedPromise(firstPageInFlight, cacheKey, async () => {
    const [page, unreadActivities] = await Promise.all([
      zero.run(
        buildUserActivitiesPaginatedV2Query({
          limit: pageSize,
          start: null,
          types: currentTypes,
          classification: classificationFilter,
          showUnreadOnly,
        }),
        COMPLETE_QUERY_OPTIONS,
      ),
      reconcileUnreadActivities({ zero, currentUserId, workspaceId, refreshNonce }),
    ]);

    const rawPage = (page as ActivityWithRelated[] | undefined) ?? [];
    const workspacePage = selectActivitiesForWorkspace(rawPage, workspaceId);
    const nextCursor = getActivityCursor(rawPage[rawPage.length - 1]);
    const hasMore = rawPage.length >= pageSize;
    const visibleRows = selectVisibleActivities(workspacePage, activeTab, showUnreadOnly);

    if (visibleRows.length === 0 && hasMore && nextCursor) {
      const displayPage = await resolveDisplayPage(rawPage, nextCursor, hasMore);
      return {
        rows: displayPage.rows,
        nextCursor: displayPage.nextCursor,
        hasMore: displayPage.hasMore,
        queryRowCount: displayPage.queryRowCount,
        unreadActivities,
      };
    }

    return {
      rows: visibleRows,
      nextCursor,
      hasMore,
      queryRowCount: rawPage.length,
      unreadActivities,
    };
  });
};
