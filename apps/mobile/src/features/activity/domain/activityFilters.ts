import { ActivityClassification } from '@xyne/shared';

import type { ActivityLike, ActivityTab, ActivityTabFilter } from './activityTypes';

export const isMentionActivity: ActivityTabFilter = activity =>
  activity?.actorAction === 'mentioned_user';

export const isReplyActivity: ActivityTabFilter = activity =>
  activity?.actorAction === 'replied' || activity?.actorAction === 'replied_v2';

export const isReactionActivity: ActivityTabFilter = activity =>
  activity?.actorAction === 'added' ||
  activity?.actorAction === 'added_v2' ||
  activity?.actorAction === 'removed' ||
  activity?.actorAction === 'removed_v2';

export const isTicketActivity: ActivityTabFilter = activity =>
  activity?.actorAction === 'eta_warning' ||
  activity?.actorAction === 'eta_breach' ||
  activity?.actorAction === 'stage_eta_breach' ||
  (activity?.ticketId !== null && activity?.ticketId !== undefined);

export const isGroupMentionActivity: ActivityTabFilter = activity =>
  activity?.actorAction === 'group_mention';

export const matchesClassification = (
  activity: ActivityLike | null | undefined,
  classification: ActivityClassification,
): boolean => {
  if (!activity) return false;
  return (activity.classification ?? ActivityClassification.PENDING) === classification;
};

export const isAllVisibleActivity = <T extends ActivityLike>(
  activity: T | null | undefined,
): activity is T => {
  if (!activity) return false;

  if (activity.actionSource === 'call' && activity.actorAction === 'missed_call') {
    return false;
  }

  const classification = activity.classification ?? ActivityClassification.PENDING;
  if (classification === ActivityClassification.SKIP) return false;
  if (activity.actorAction === 'direct_message') {
    return (
      classification === ActivityClassification.ACTIONABLE ||
      classification === ActivityClassification.FYI
    );
  }
  return true;
};

const tabFilterMap: Record<ActivityTab, ActivityTabFilter> = {
  all: isAllVisibleActivity,
  ['your_mentions']: isMentionActivity,
  replies: isReplyActivity,
  reactions: isReactionActivity,
  tickets: isTicketActivity,
  actionable: activity => matchesClassification(activity, ActivityClassification.ACTIONABLE),
  fyi: activity => matchesClassification(activity, ActivityClassification.FYI),
  ['group_mentions']: isGroupMentionActivity,
};

export const matchesActivityTab = (
  activity: ActivityLike | null | undefined,
  tab: ActivityTab,
): boolean => tabFilterMap[tab]?.(activity) ?? false;

export const getActivityTypes = (tab: ActivityTab): string[] => {
  switch (tab) {
    case 'your_mentions':
      return ['mentioned_user'];
    case 'replies':
      return ['replied', 'replied_v2'];
    case 'reactions':
      return ['added', 'added_v2', 'removed', 'removed_v2'];
    case 'group_mentions':
      return ['group_mention'];
    case 'tickets':
      return [
        'eta_warning',
        'eta_breach',
        'stage_eta_breach',
        'ticket_assigned',
        'ticket_status',
        'ticket_eta',
        'ticket_board',
        'ticket_assigned_to',
        'ticket_pr_created',
        'ticket_pr_updated',
        'ticket_pr_merged',
        'ticket_pr_declined',
        'ticket_pr_reviewer_assigned',
        'ticket_qa_assigned',
        'workflow_question',
      ];
    default:
      return [];
  }
};

export const getClassificationFilter = (tab: ActivityTab): ActivityClassification[] | undefined => {
  switch (tab) {
    case 'actionable':
      return [ActivityClassification.ACTIONABLE];
    case 'fyi':
      return [ActivityClassification.FYI];
    default:
      return undefined;
  }
};
