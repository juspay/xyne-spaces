import { ReactElement } from 'react';
import type { ActivityWithRelated } from '../../types/activity';
import { MessageMentionActivity } from './MessageMentionActivity';
import { CanvasMentionActivity } from './CanvasMentionActivity';
import { MessageRepliedActivity } from './MessageRepliedActivity';
import { MessageRepliedActivityV2 } from './MessageRepliedActivityV2';
import { ReactionAddedActivity } from './ReactionAddedActivity';
import { ReactionAddedActivityV2 } from './ReactionAddedActivityV2';
import { DirectMessageActivity } from './DirectMessageActivity';
import { EtaActivity } from './EtaActivity';
import { AssignmentPauseActivity } from './AssignmentPauseActivity';
import { TicketAssignmentActivity } from './TicketAssignmentActivity';
import { TicketUpdateActivity } from './TicketUpdateActivity';
import { WorkflowQuestionActivity } from './WorkflowQuestionActivity';
import { ScheduledCallActivity } from './ScheduledCallActivity';

interface ActivityItemProps {
  activity: ActivityWithRelated;
  isExpanded: boolean;
}

export const ActivityItem = ({ activity, isExpanded }: ActivityItemProps): ReactElement | null => {
  switch (activity.actorAction) {
    case 'mentioned_user':
      if (activity.canvasId) {
        return <CanvasMentionActivity activity={activity} isExpanded={isExpanded} />;
      }
      return <MessageMentionActivity activity={activity} isExpanded={isExpanded} />;

    case 'group_mention':
      return <MessageMentionActivity activity={activity} isExpanded={isExpanded} />;

    case 'direct_message':
      return <DirectMessageActivity activity={activity} isExpanded={isExpanded} />;

    case 'replied':
      return <MessageRepliedActivity activity={activity} isExpanded={isExpanded} />;

    case 'replied_v2':
      return <MessageRepliedActivityV2 activity={activity} isExpanded={isExpanded} />;

    case 'added':
      return <ReactionAddedActivity activity={activity} isExpanded={isExpanded} />;

    case 'added_v2':
      return <ReactionAddedActivityV2 activity={activity} isExpanded={isExpanded} />;

    case 'removed':
      return <ReactionAddedActivity activity={activity} isExpanded={isExpanded} />;

    case 'eta_warning':
    case 'eta_breach':
    case 'stage_eta_breach':
      return <EtaActivity activity={activity} isExpanded={isExpanded} />;

    case 'paused_from_assignment':
    case 'resumed_from_assignment':
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
    case 'ticket_pr_reviewer_assigned':
    case 'ticket_qa_assigned':
      return <TicketUpdateActivity activity={activity} isExpanded={isExpanded} />;

    case 'workflow_question':
      return <WorkflowQuestionActivity activity={activity} isExpanded={isExpanded} />;

    case 'scheduled_call':
    case 'call_reminder':
      return <ScheduledCallActivity activity={activity} isExpanded={isExpanded} />;

    default:
      return null;
  }
};
