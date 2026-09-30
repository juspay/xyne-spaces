import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { ActivityWithRelated } from '../../../types/activity';
import { ActivityItem } from '../ActivityItem';
import { GenericActivity, getGenericActivityText } from '../GenericActivity';

// Only the renderer selection in `ActivityItem` is under test, so the renderers
// and the generic row's dependencies are replaced with light stand-ins. The
// real modules pull in browser-only code at import time.
vi.mock('../MessageMentionActivity', () => ({ MessageMentionActivity: (): null => null }));
vi.mock('../KeywordMatchActivity', () => ({ KeywordMatchActivity: (): null => null }));
vi.mock('../CanvasMentionActivity', () => ({ CanvasMentionActivity: (): null => null }));
vi.mock('../MessageRepliedActivity', () => ({ MessageRepliedActivity: (): null => null }));
vi.mock('../MessageRepliedActivityV2', () => ({ MessageRepliedActivityV2: (): null => null }));
vi.mock('../ReactionAddedActivity', () => ({ ReactionAddedActivity: (): null => null }));
vi.mock('../ReactionAddedActivityV2', () => ({ ReactionAddedActivityV2: (): null => null }));
vi.mock('../DirectMessageActivity', () => ({ DirectMessageActivity: (): null => null }));
vi.mock('../EtaActivity', () => ({ EtaActivity: (): null => null }));
vi.mock('../AssignmentPauseActivity', () => ({ AssignmentPauseActivity: (): null => null }));
vi.mock('../TicketAssignmentActivity', () => ({ TicketAssignmentActivity: (): null => null }));
vi.mock('../TicketUpdateActivity', () => ({ TicketUpdateActivity: (): null => null }));
vi.mock('../ScheduledCallActivity', () => ({ ScheduledCallActivity: (): null => null }));
vi.mock('../EmailFetchActivity', () => ({ EmailFetchActivity: (): null => null }));
vi.mock('../CanvasSharedActivity', () => ({ CanvasSharedActivity: (): null => null }));
vi.mock('../RecordingSharedActivity', () => ({ RecordingSharedActivity: (): null => null }));
vi.mock('../RecordingSummaryActivity', () => ({ RecordingSummaryActivity: (): null => null }));
vi.mock('../SummaryTemplateSharedActivity', () => ({
  SummaryTemplateSharedActivity: (): null => null,
}));
vi.mock('../StageApprovalActivity', () => ({ StageApprovalActivity: (): null => null }));
vi.mock('../KbIngestionActivity', () => ({ KbIngestionActivity: (): null => null }));
vi.mock('../SlashCommandArtifactActivity', () => ({
  SlashCommandArtifactActivity: (): null => null,
}));
vi.mock('../MaxWorkloadActivity', () => ({ MaxWorkloadActivity: (): null => null }));
vi.mock('../ActivityItemCard', () => ({ ActivityItemCard: (): null => null }));
vi.mock('../../../hooks/useUsers', () => ({ useUser: (): undefined => undefined }));
vi.mock('../../../hooks/useRouteContext', () => ({
  useRouteContext: (): { baseRoute: string } => ({ baseRoute: '' }),
}));
vi.mock('../../../utils/userDisplayName', () => ({ getUserDisplayName: (): string => '' }));

/**
 * Every `actorAction` the backend can create. When a new action is added,
 * add it here so the test makes sure it gets a renderer.
 */
const KNOWN_ACTIVITY_ACTIONS = [
  'slash_command_artifact',
  'mentioned_user',
  'group_mention',
  'keyword_match',
  'direct_message',
  'replied',
  'replied_v2',
  'added',
  'added_v2',
  'removed',
  'eta_warning',
  'eta_breach',
  'stage_eta_breach',
  'paused_from_assignment',
  'resumed_from_assignment',
  'ticket_assigned',
  'ticket_status',
  'ticket_status_v2',
  'ticket_merged',
  'ticket_merged_target',
  'ticket_unmerged',
  'ticket_unmerged_target',
  'ticket_stage_eta',
  'ticket_eta',
  'ticket_board',
  'ticket_assigned_to',
  'ticket_priority',
  'ticket_user_group',
  'ticket_title',
  'ticket_description',
  'ticket_rca_created',
  'ticket_rca_updated',
  'ticket_subticket_added',
  'ticket_reference_added',
  'ticket_reference_removed',
  'ticket_multi_updated',
  'ticket_pr_created',
  'ticket_pr_updated',
  'ticket_pr_merged',
  'ticket_pr_declined',
  'ticket_pr_reviewer_assigned',
  'ticket_qa_assigned',
  'ticket_release_started',
  'ticket_release_completed',
  'ticket_release_cancelled',
  'ticket_release_paused',
  'ticket_release_planning',
  'scheduled_call',
  'call_reminder',
  'call_updated',
  'meeting_accepted',
  'meeting_declined',
  'email_fetch_completed',
  'email_fetch_failed',
  'canvas_shared',
  'canvas_role_changed',
  'canvas_access_revoked',
  'recording_shared',
  'recording_access_changed',
  'recording_access_revoked',
  'recording_summary_ready',
  'summary_template_shared',
  'summary_template_access_revoked',
  'stage_approval_requested',
  'stage_approval_approved',
  'stage_approval_rejected',
  'kb_ingestion_completed',
  'max_workload_reached',
  'workflow_question',
  'missed_call',
  'delayed_message_cancelled',
  'delayed_message_failed',
  'created',
  'archived',
  'visibility_changed',
];

// `ActivityItem` is a memo component; its inner function only picks which
// renderer to return, so it can be called directly without mounting anything.
const renderActivityItem = (actorAction: string): ReactElement | null => {
  const { type: render } = ActivityItem as unknown as {
    type: (props: { activity: ActivityWithRelated; isExpanded: boolean }) => ReactElement | null;
  };
  return render({ activity: { actorAction } as ActivityWithRelated, isExpanded: false });
};

describe('ActivityItem', () => {
  it.each(KNOWN_ACTIVITY_ACTIONS)('has a renderer for %s', actorAction => {
    const FALLBACK_TEXT = getGenericActivityText('some_future_action');
    const element = renderActivityItem(actorAction);

    expect(element).not.toBeNull();
    if (element?.type === GenericActivity) {
      // Known actions may use the generic row, but only with their own text.
      expect(getGenericActivityText(actorAction)).not.toBe(FALLBACK_TEXT);
    }
  });

  it('renders a visible fallback row for unknown actions', () => {
    const element = renderActivityItem('some_future_action');

    expect(element?.type).toBe(GenericActivity);
  });
});
