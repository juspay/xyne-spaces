import { ActivityClassification } from '@xyne/shared';

import { queries } from '@/src/zero/queries';
import type { ActivityCursor } from '@/src/utils/activitySnapshotCache';

export const ACTIVITY_FIRST_PAGE_SIZE = 20;

type BuildUserActivitiesPaginatedV2QueryArgs = {
  limit: number;
  start: ActivityCursor | null;
  types: string[];
  classification?: ActivityClassification[] | undefined;
  showUnreadOnly: boolean;
};

export const buildUserActivitiesPaginatedV2Query = ({
  limit,
  start,
  types,
  classification,
  showUnreadOnly,
}: BuildUserActivitiesPaginatedV2QueryArgs): ReturnType<typeof queries.userActivitiesPaginatedV2> =>
  queries.userActivitiesPaginatedV2({
    limit,
    start,
    types,
    classification,
    ...(showUnreadOnly ? { isRead: false } : {}),
  });
