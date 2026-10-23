import { ActivityClassification } from '@xyne/shared';

export type ActivityLike = {
  id?: string;
  workspaceId?: string | null;
  actorAction?: string | null;
  classification?: ActivityClassification | null;
  actionSource?: string | null;
  channelId?: string | null;
  isThreadActivity?: boolean | null;
  ticketId?: string | null;
  isRead?: boolean | null;
  updatedAt?: number | null;
  createdAt?: number | null;
};

export type ActivityTab =
  | 'all'
  | 'your_mentions'
  | 'replies'
  | 'reactions'
  | 'tickets'
  | 'actionable'
  | 'fyi'
  | 'group_mentions';

export type ActivityCounts = Record<ActivityTab, number>;

export const EMPTY_ACTIVITY_COUNTS: ActivityCounts = {
  all: 0,
  ['your_mentions']: 0,
  replies: 0,
  reactions: 0,
  tickets: 0,
  actionable: 0,
  fyi: 0,
  ['group_mentions']: 0,
};

export type ActivityTabFilter = (activity: ActivityLike | null | undefined) => boolean;
