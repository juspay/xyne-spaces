import { memo, ReactElement } from 'react';
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
import { EmailFetchActivity } from './EmailFetchActivity';
import { CanvasSharedActivity } from './CanvasSharedActivity';

interface ActivityItemProps {
  activity: ActivityWithRelated;
  isExpanded: boolean;
  isSelected?: boolean;
}

// memo: rows are rendered inside Virtuoso with a 2000px overscan (~40-60
// mounted rows). Without memo, every list-level state change (selection,
// mark-as-read, unread-count updates) re-rendered every mounted row — the
// main cause of the CPU spike when opening an activity.
export const ActivityItem = memo(function ActivityItem({
  activity,
  isExpanded,
  isSelected = false,
}: ActivityItemProps): ReactElement | null {
  switch (activity.actorAction) {
    case 'mentioned_user':
      if (activity.canvasId) {
        return (
          <CanvasMentionActivity
            activity={activity}
            isExpanded={isExpanded}
            isSelected={isSelected}
          />
        );
      }
      return (
        <MessageMentionActivity
          activity={activity}
          isExpanded={isExpanded}
          isSelected={isSelected}
        />
      );

    case 'group_mention':
      return (
        <MessageMentionActivity
          activity={activity}
          isExpanded={isExpanded}
          isSelected={isSelected}
        />
      );

    case 'direct_message':
      return (
        <DirectMessageActivity
          activity={activity}
          isExpanded={isExpanded}
          isSelected={isSelected}
        />
      );

    case 'replied':
      return (
        <MessageRepliedActivity
          activity={activity}
          isExpanded={isExpanded}
          isSelected={isSelected}
        />
      );

    case 'replied_v2':
      return (
        <MessageRepliedActivityV2
          activity={activity}
          isExpanded={isExpanded}
          isSelected={isSelected}
        />
      );

    case 'added':
      return (
        <ReactionAddedActivity
          activity={activity}
          isExpanded={isExpanded}
          isSelected={isSelected}
        />
      );

    case 'added_v2':
      return (
        <ReactionAddedActivityV2
          activity={activity}
          isExpanded={isExpanded}
          isSelected={isSelected}
        />
      );

    case 'removed':
      return (
        <ReactionAddedActivity
          activity={activity}
          isExpanded={isExpanded}
          isSelected={isSelected}
        />
      );

    case 'eta_warning':
    case 'eta_breach':
    case 'stage_eta_breach':
      return <EtaActivity activity={activity} isExpanded={isExpanded} isSelected={isSelected} />;

    case 'paused_from_assignment':
    case 'resumed_from_assignment':
      return (
        <AssignmentPauseActivity
          activity={activity}
          isExpanded={isExpanded}
          isSelected={isSelected}
        />
      );

    case 'ticket_assigned':
      return (
        <TicketAssignmentActivity
          activity={activity}
          isExpanded={isExpanded}
          isSelected={isSelected}
        />
      );

    case 'ticket_status':
    case 'ticket_eta':
    case 'ticket_board':
      return (
        <TicketUpdateActivity activity={activity} isExpanded={isExpanded} isSelected={isSelected} />
      );

    case 'ticket_pr_created':
    case 'ticket_pr_updated':
    case 'ticket_pr_merged':
    case 'ticket_pr_declined':
    case 'ticket_pr_reviewer_assigned':
    case 'ticket_qa_assigned':
      return (
        <TicketUpdateActivity activity={activity} isExpanded={isExpanded} isSelected={isSelected} />
      );

    case 'workflow_question':
      return (
        <WorkflowQuestionActivity
          activity={activity}
          isExpanded={isExpanded}
          isSelected={isSelected}
        />
      );

    case 'scheduled_call':
    case 'call_reminder':
    case 'call_updated':
    case 'meeting_accepted':
    case 'meeting_declined':
      return (
        <ScheduledCallActivity
          activity={activity}
          isExpanded={isExpanded}
          isSelected={isSelected}
        />
      );

    case 'email_fetch_completed':
    case 'email_fetch_failed':
      return <EmailFetchActivity activity={activity} isExpanded={isExpanded} />;

    case 'canvas_shared':
    case 'canvas_role_changed':
    case 'canvas_access_revoked':
      return <CanvasSharedActivity activity={activity} isExpanded={isExpanded} />;

    default:
      return null;
  }
});
