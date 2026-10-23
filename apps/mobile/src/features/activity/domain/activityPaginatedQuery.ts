import { ActivityClassification } from '@xyne/shared';

import { queries } from '@/src/zero/queries';
import type { ActivityCursor } from '@/src/utils/activitySnapshotCache';

import type { ActivityActorFilter } from './activityActorFilter';

export const ACTIVITY_FIRST_PAGE_SIZE = 20;

type BuildUserActivitiesPaginatedV2QueryArgs = {
  limit: number;
  start: ActivityCursor | null;
  types: string[];
  classification?: ActivityClassification[] | undefined;
  showUnreadOnly: boolean;
  actor?: ActivityActorFilter | undefined;
};

export const buildUserActivitiesPaginatedV2Query = ({
  limit,
  start,
  types,
  classification,
  showUnreadOnly,
  actor,
}: BuildUserActivitiesPaginatedV2QueryArgs): ReturnType<typeof queries.userActivitiesPaginatedV2> =>
  queries.userActivitiesPaginatedV2({
    limit,
    start,
    types,
    classification,
    ...(showUnreadOnly ? { isRead: false } : {}),
    ...(actor?.types && actor.types.length > 0 ? { actorTypes: [...actor.types] } : {}),
    ...(actor?.id ? { actorId: actor.id } : {}),
  });
