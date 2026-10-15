import { QueryResultType } from '@rocicorp/zero';
import { queries } from '../zero/queries';
import { AtSign, MessageCircleMore } from 'lucide-react-native';
import { ActivityClassification } from '@xyne/shared';

import {
  isAllVisibleActivity,
  isGroupMentionActivity,
  isMentionActivity,
  isReactionActivity,
  isReplyActivity,
  isTicketActivity,
  matchesClassification,
} from '@/src/features/activity/domain/activityFilters';
import type { ActivityLike, ActivityTab } from '@/src/features/activity/domain/activityTypes';

export type { ActivityLike, ActivityTab } from '@/src/features/activity/domain/activityTypes';
export {
  getClassificationFilter,
  getActivityTypes,
  isAllVisibleActivity,
  matchesActivityTab,
} from '@/src/features/activity/domain/activityFilters';
export { getUnreadActivityCounts } from '@/src/features/activity/domain/activitySelectors';

export type ActivityWithRelated = QueryResultType<
  ReturnType<typeof queries.userActivitiesPaginatedV2>
>[number];

export type ActivityIconType =
  'mention' | 'reply' | 'reaction' | 'message' | 'warning' | 'ticket' | 'default';

export interface TabConfig {
  value: ActivityTab;
  label: string;
  filter: (activity: ActivityLike | null | undefined) => boolean;
  Icon?: React.ComponentType<{ size: number; color: string }>;
}

export const TABS: TabConfig[] = [
  { value: 'all', label: 'All', filter: isAllVisibleActivity },
  {
    value: 'your_mentions',
    label: 'Mentions',
    filter: isMentionActivity,
    Icon: AtSign,
  },
  {
    value: 'replies',
    label: 'Replies',
    filter: isReplyActivity,
    Icon: MessageCircleMore,
  },
  {
    value: 'reactions',
    label: 'Reactions',
    filter: isReactionActivity,
  },
  {
    value: 'tickets',
    label: 'Tickets',
    filter: isTicketActivity,
  },
  {
    value: 'group_mentions',
    label: 'Group Mentions',
    filter: isGroupMentionActivity,
  },
  {
    value: 'actionable',
    label: 'Actionable',
    filter: activity => matchesClassification(activity, ActivityClassification.ACTIONABLE),
  },
  {
    value: 'fyi',
    label: 'FYI',
    filter: activity => matchesClassification(activity, ActivityClassification.FYI),
  },
];

export const actionableValues = new Set<ActivityTab>(['actionable', 'fyi']);
