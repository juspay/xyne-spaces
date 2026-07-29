import { QueryResultType } from '@rocicorp/zero';
import { queries } from '../zero/queries';

export type ActivityWithRelated = QueryResultType<typeof queries.userActivitiesV2>[number];
