import { memo, type ComponentType, type ReactElement, useMemo } from 'react';
import { useSelector } from '@xstate/react';
import { AssignmentPauseActivity } from '../assignment-pause-activity';
import { CanvasMentionActivity } from '../canvas-mention-activity';
import { DirectMessageActivity } from '../direct-message-activity';
import { EtaActivity } from '../eta-activity';
import { MessageMentionActivity } from '../message-mention-activity';
import { MessageRepliedActivity } from '../message-replied-activity';
import { MessageRepliedActivityV2 } from '../message-replied-activity-v2';
import { ReactionAddedActivity } from '../reaction-added-activity';
import { ReactionAddedActivityV2 } from '../reaction-added-activity-v2';
import { ScheduledCallActivity } from '../scheduled-call-activity';
import { TicketAssignmentActivity } from '../ticket-assignment-activity';
import { TicketUpdateActivity } from '../ticket-update-activity';
import { WorkflowQuestionActivity } from '../workflow-question-activity';
import type { ActivityV2Props } from './activity-v2.types';
import { ActivityRemoteAvatarLoadProvider } from './activity-avatar-load-context';
import { ActivityRenderProvider } from './activity-render-context';
import { stateMachineActor } from '@/src/machines/appStateMachine';
import { useAuth } from '@/src/contexts/AuthContext';
import { assembleActivityRowVm } from '@/src/features/activity/presentation/activityRowAssembler';
import { getChannelDisplayName } from '@/src/hooks/useChannels';

const ACTIVITY_RENDERERS = new Map<
  string,
  ComponentType<{ activity: ActivityV2Props['activity'] }>
>([
  ['group_mention', MessageMentionActivity],
  ['direct_message', DirectMessageActivity],
  ['replied', MessageRepliedActivity],
  ['replied_v2', MessageRepliedActivityV2],
  ['added', ReactionAddedActivity],
  ['added_v2', ReactionAddedActivityV2],
  ['removed', ReactionAddedActivity],
  ['removed_v2', ReactionAddedActivityV2],
  ['eta_warning', EtaActivity],
  ['eta_breach', EtaActivity],
  ['stage_eta_breach', EtaActivity],
  ['paused_from_assignment', AssignmentPauseActivity],
  ['resumed_from_assignment', AssignmentPauseActivity],
  ['ticket_assigned', TicketAssignmentActivity],
  ['ticket_status', TicketUpdateActivity],
  ['ticket_eta', TicketUpdateActivity],
  ['ticket_board', TicketUpdateActivity],
  ['ticket_assigned_to', TicketUpdateActivity],
  ['ticket_pr_created', TicketUpdateActivity],
  ['ticket_pr_updated', TicketUpdateActivity],
  ['ticket_pr_merged', TicketUpdateActivity],
  ['ticket_pr_declined', TicketUpdateActivity],
  ['ticket_pr_reviewer_assigned', TicketUpdateActivity],
  ['ticket_qa_assigned', TicketUpdateActivity],
  ['workflow_question', WorkflowQuestionActivity],
  ['scheduled_call', ScheduledCallActivity],
  ['call_reminder', ScheduledCallActivity],
  ['call_updated', ScheduledCallActivity],
  ['meeting_accepted', ScheduledCallActivity],
  ['meeting_declined', ScheduledCallActivity],
]);

function ActivityV2({
  activity,
  shouldLoadRemoteAvatars = false,
  compactPreviews = false,
}: ActivityV2Props): ReactElement | null {
  const { user } = useAuth();
  const users = useSelector(stateMachineActor, state => state.context.users);
  const visibleChannels = useSelector(stateMachineActor, state => state.context.visibleChannels);
  const usersById = useMemo(
    () => new Map(users.map(candidate => [candidate.id, candidate])),
    [users],
  );
  const visibleChannelsById = useMemo(
    () => new Map(visibleChannels.map(candidate => [candidate.id, candidate])),
    [visibleChannels],
  );
  const rowVm = useMemo(() => {
    const actorId = activity.actorId ?? activity.message?.senderId ?? 'system';
    const actor = usersById.get(actorId);
    const channelId =
      activity.message?.conversation?.channelId ??
      activity.ticket?.channelId ??
      activity.channelId ??
      '';
    const channel = visibleChannelsById.get(channelId) ?? null;
    const actorName =
      actor?.displayName || actor?.name || actor?.email || (activity.actorId ? undefined : 'Xyne');
    const channelLabel =
      channel && user?.user_id ? getChannelDisplayName(channel, user.user_id, users) : undefined;

    return assembleActivityRowVm({
      activity,
      actorId,
      actorAvatarUrl: actor?.picture ?? '',
      channel,
      currentUserId: user?.user_id ?? '',
      users,
      ...(channelLabel !== undefined ? { channelLabel } : {}),
      ...(actorName ? { actorName } : {}),
    });
  }, [activity, user?.user_id, users, usersById, visibleChannelsById]);

  let content: ReactElement | null = null;

  if (activity.actorAction === 'mentioned_user') {
    content = activity.canvasId ? (
      <CanvasMentionActivity activity={activity} />
    ) : (
      <MessageMentionActivity activity={activity} />
    );
  } else {
    const Renderer = ACTIVITY_RENDERERS.get(activity.actorAction);
    content = Renderer ? <Renderer activity={activity} /> : null;
  }

  if (!content) {
    return null;
  }

  return (
    <ActivityRemoteAvatarLoadProvider value={shouldLoadRemoteAvatars}>
      <ActivityRenderProvider value={{ compactPreviews, rowVm }}>{content}</ActivityRenderProvider>
    </ActivityRemoteAvatarLoadProvider>
  );
}

export default memo(ActivityV2);
