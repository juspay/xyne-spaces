import { ReactElement } from 'react';
import type { ActivityWithRelated } from '../../types/activity';
import { MessageMentionActivity } from './MessageMentionActivity';
import { MessageRepliedActivity } from './MessageRepliedActivity';
import { ReactionAddedActivity } from './ReactionAddedActivity';
import { DirectMessageActivity } from './DirectMessageActivity';
import { EtaActivity } from './EtaActivity';
import { AssignmentPauseActivity } from './AssignmentPauseActivity';
import { TicketAssignmentActivity } from './TicketAssignmentActivity';
import { TicketUpdateActivity } from './TicketUpdateActivity';

interface ActivityItemProps {
  activity: ActivityWithRelated;
  isExpanded: boolean;
}

export const ActivityItem = ({ activity, isExpanded }: ActivityItemProps): ReactElement | null => {
  switch (activity.actorAction) {
    case 'mentioned_user':
    case 'group_mention':
      return <MessageMentionActivity activity={activity} isExpanded={isExpanded} />;

    case 'direct_message':
      return <DirectMessageActivity activity={activity} isExpanded={isExpanded} />;

    case 'replied':
      return <MessageRepliedActivity activity={activity} isExpanded={isExpanded} />;

    case 'added':
      return <ReactionAddedActivity activity={activity} isExpanded={isExpanded} />;

    case 'removed':
      return <ReactionAddedActivity activity={activity} isExpanded={isExpanded} />;

    case 'eta_warning':
    case 'eta_breach':
      return <EtaActivity activity={activity} isExpanded={isExpanded} />;

    case 'paused_from_assignment':
      return <AssignmentPauseActivity activity={activity} isExpanded={isExpanded} />;

    case 'ticket_assigned':
      return <TicketAssignmentActivity activity={activity} isExpanded={isExpanded} />;

    case 'ticket_status':
    case 'ticket_eta':
    case 'ticket_board':
      return <TicketUpdateActivity activity={activity} isExpanded={isExpanded} />;

    case 'ticket_pr_created':
    case 'ticket_pr_updated':
    case 'ticket_pr_merged':
    case 'ticket_pr_declined':
      return <TicketUpdateActivity activity={activity} isExpanded={isExpanded} />;

    default:
      return null;
  }
};
