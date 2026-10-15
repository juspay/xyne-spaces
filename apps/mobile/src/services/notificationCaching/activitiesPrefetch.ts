import type { ActivityWithRelated } from '@/src/types/activity';
import {
  deriveActivitiesWatermark,
  mergeActivitiesIntoSnapshot,
} from '@/src/utils/activitySnapshotCache';
import { mmkvStorageAdapter } from '@/src/services/mmkvStorageAdapter';
import { ACTIVITY_FIRST_PAGE_SIZE } from '@/src/features/activity/domain/activityPaginatedQuery';

import { executeFallbackQuery } from '../zeroFallbackClient';
import { NOTIF_CONFIRM } from './confirmLog';

/**
 * Push-driven activity prefetch. Reads the "all" tab snapshot's max `updatedAt`,
 * calls `userActivitiesPaginatedV2` over the fallback HTTP path with that watermark,
 * and merges the returned rows into the snapshot so the next cold-start renders
 * instantly with fresh content. Background callers must await this promise so
 * the OS keeps the killed-state handler alive until the snapshot write lands.
 */
export async function prefetchActivitiesDelta(): Promise<void> {
  const { userId, workspaceId } = mmkvStorageAdapter.getGlobalUserContext();
  if (!userId || !workspaceId) {
    console.log(NOTIF_CONFIRM, 'activities prefetch skipped: no workspace session');
    return;
  }

  const since = deriveActivitiesWatermark(userId, workspaceId);

  try {
    const data = (await executeFallbackQuery('userActivitiesPaginatedV2', {
      limit: ACTIVITY_FIRST_PAGE_SIZE,
      start: null,
      types: [],
      since: since > 0 ? since : undefined,
    })) as ActivityWithRelated[] | null;

    const rows = Array.isArray(data) ? data : [];
    if (rows.length === 0) {
      console.log(NOTIF_CONFIRM, 'activities prefetch: 0 new rows since watermark', { since });
      return;
    }

    mergeActivitiesIntoSnapshot<ActivityWithRelated>(userId, workspaceId, rows);
    console.log(NOTIF_CONFIRM, 'activities prefetch: merged rows into snapshot', {
      since,
      count: rows.length,
    });
  } catch (error) {
    console.warn(NOTIF_CONFIRM, 'activities prefetch FAILED', {
      since,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
