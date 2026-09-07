import { memo, ReactElement } from 'react';
import type { ActivityWithRelated } from '../../types/activity';
import { MessageMentionActivity } from './MessageMentionActivity';
import { KeywordMatchActivity } from './KeywordMatchActivity';
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
import { ScheduledCallActivity } from './ScheduledCallActivity';
import { EmailFetchActivity } from './EmailFetchActivity';
import { CanvasSharedActivity } from './CanvasSharedActivity';
import { RecordingSharedActivity } from './RecordingSharedActivity';
import { SummaryTemplateSharedActivity } from './SummaryTemplateSharedActivity';
import { StageApprovalActivity } from './StageApprovalActivity';
import { KbIngestionActivity } from './KbIngestionActivity';
import { SlashCommandArtifactActivity } from './SlashCommandArtifactActivity';
import { MaxWorkloadActivity } from './MaxWorkloadActivity';

interface ActivityItemProps {
  activity: ActivityWithRelated;
  isExpanded: boolean;
}

// memo: rows are rendered inside Virtuoso with a 2000px overscan (~40-60
// mounted rows). Without memo, every list-level state change (mark-as-read,
// unread-count updates) re-rendered every mounted row — the main cause of
// the CPU spike when opening an activity. Selection highlighting is fully
// imperative (data-selected stamped by ActivityListView), so it never
// invalidates the memo.
export const ActivityItem = memo(function ActivityItem({
  activity,
  isExpanded,
}: ActivityItemProps): ReactElement | null {
  switch (activity.actorAction) {
    case 'slash_command_artifact':
      return <SlashCommandArtifactActivity activity={activity} isExpanded={isExpanded} />;

    case 'mentioned_user':
      if (activity.canvasId) {
        return <CanvasMentionActivity activity={activity} isExpanded={isExpanded} />;
      }
      return <MessageMentionActivity activity={activity} isExpanded={isExpanded} />;

    case 'group_mention':
      return <MessageMentionActivity activity={activity} isExpanded={isExpanded} />;

    case 'keyword_match':
      return <KeywordMatchActivity activity={activity} isExpanded={isExpanded} />;

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
    case 'ticket_assigned_to':
    case 'ticket_priority':
    case 'ticket_user_group':
    case 'ticket_title':
    case 'ticket_description':
    case 'ticket_rca_created':
    case 'ticket_rca_updated':
    case 'ticket_subticket_added':
    case 'ticket_reference_added':
    case 'ticket_reference_removed':
    case 'ticket_multi_updated':
      return <TicketUpdateActivity activity={activity} isExpanded={isExpanded} />;

    case 'ticket_pr_created':
    case 'ticket_pr_updated':
    case 'ticket_pr_merged':
    case 'ticket_pr_declined':
    case 'ticket_pr_reviewer_assigned':
    case 'ticket_qa_assigned':
    case 'ticket_release_started':
    case 'ticket_release_completed':
    case 'ticket_release_cancelled':
    case 'ticket_release_paused':
    case 'ticket_release_planning':
      return <TicketUpdateActivity activity={activity} isExpanded={isExpanded} />;

    case 'scheduled_call':
    case 'call_reminder':
    case 'call_updated':
    case 'meeting_accepted':
    case 'meeting_declined':
      return <ScheduledCallActivity activity={activity} isExpanded={isExpanded} />;

    case 'email_fetch_completed':
    case 'email_fetch_failed':
      return <EmailFetchActivity activity={activity} isExpanded={isExpanded} />;

    case 'canvas_shared':
    case 'canvas_role_changed':
    case 'canvas_access_revoked':
      return <CanvasSharedActivity activity={activity} isExpanded={isExpanded} />;

    case 'recording_shared':
    case 'recording_access_revoked':
      return <RecordingSharedActivity activity={activity} isExpanded={isExpanded} />;

    case 'summary_template_shared':
    case 'summary_template_access_revoked':
      return <SummaryTemplateSharedActivity activity={activity} isExpanded={isExpanded} />;

    case 'stage_approval_requested':
    case 'stage_approval_approved':
    case 'stage_approval_rejected':
      return <StageApprovalActivity activity={activity} isExpanded={isExpanded} />;

    case 'kb_ingestion_completed':
      return <KbIngestionActivity activity={activity} isExpanded={isExpanded} />;

    case 'max_workload_reached':
      return <MaxWorkloadActivity activity={activity} isExpanded={isExpanded} />;

    default:
      return null;
  }
});
