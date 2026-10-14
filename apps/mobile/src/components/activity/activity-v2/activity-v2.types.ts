import type { QueryResultType } from '@rocicorp/zero';
import { queries } from '@/src/zero/queries';
type Activity = QueryResultType<ReturnType<typeof queries.userActivitiesPaginatedV2>>[number];

interface ActivityV2Props {
  activity: Activity;
  shouldLoadRemoteAvatars?: boolean;
  compactPreviews?: boolean;
}

export type { ActivityV2Props };
