import { format, formatDistanceToNowStrict, isToday } from 'date-fns';
import { router } from 'expo-router';

import { parseTicketMd, type Channel } from '@xyne/shared';

import { navigateToMessage } from '@/src/components/activity/activity-v2-nav';
import { shouldOpenActivityThread } from '@/src/components/activity/activity-v2-navigation-logic';
import { getChannelDisplayName } from '@/src/hooks/useChannels';
import type { ActivityWithRelated } from '@/src/types/activity';

export type ActivityMessagePreviewKind = 'conversation' | 'message' | 'none';

export type ActivityRowVM = {
  id: string;
  actorAction: string;
  isUnread: boolean;
  actorId: string;
  actorName: string;
  actorAvatarUrl: string;
  channelId: string | undefined;
  channelLabel: string | undefined;
  description: string;
  timeLabel: string;
  navigationTarget: ActivityNavigationTarget;
  messagePreviewKind: ActivityMessagePreviewKind;
  activity: ActivityWithRelated;
};

export type ActivityNavigationTarget =
  | {
      kind: 'ticket';
      ticketId: string;
      selectedTab?: 'overview' | 'thread' | 'activity';
      channelId?: string | undefined;
      threadId?: string | undefined;
      messageId?: string | undefined;
    }
  | {
      kind: 'message';
      channelId: string;
      conversationId: string;
      messageId: string;
      isThreadReply: boolean;
      conversationCreatedAt: number;
    }
  | {
      kind: 'channel';
      channelId: string;
    }
  | {
      kind: 'none';
    };

export const navigateToActivityTarget = (target: ActivityNavigationTarget): void => {
  if (target.kind === 'none') {
    return;
  }

  if (target.kind === 'channel') {
    navigateToMessage({ channelId: target.channelId });
    return;
  }

  if (target.kind === 'ticket') {
    router.push({
      pathname: '/ticket/[ticketId]',
      params: {
        ticketId: target.ticketId,
        ...(target.selectedTab ? { selectedTab: target.selectedTab } : {}),
        ...(target.channelId ? { channelId: target.channelId } : {}),
        ...(target.threadId ? { threadId: target.threadId } : {}),
        ...(target.messageId ? { messageId: target.messageId } : {}),
      },
    });
    return;
  }

  navigateToMessage({
    channelId: target.channelId,
    conversationId: target.conversationId,
    messageId: target.messageId,
    isThreadReply: target.isThreadReply,
    conversationCreatedAt: target.conversationCreatedAt,
  });
};

type AssembleActivityRowVmOptions = {
  activity: ActivityWithRelated;
  actorName?: string;
  actorAvatarUrl?: string;
  actorId?: string;
  channel?: Channel | null;
  currentUserId: string;
  users: ReadonlyArray<{ id: string; name?: string }>;
  channelLabel?: string;
  description?: string;
  navigationTarget?: ActivityNavigationTarget;
};

const DEFAULT_DESCRIPTION_BY_ACTION: Partial<Record<string, string>> = {
  mentioned_user: 'mentioned you in',
  group_mention: 'mentioned you in',
  direct_message: 'sent you a DM in',
  replied: 'replied to your message in',
  replied_v2: 'replied to your message in',
  added: 'reacted to your message in',
  added_v2: 'reacted to your message in',
  removed: 'removed reaction from your message in',
  removed_v2: 'removed reaction from your message in',
  eta_warning: 'updated ticket in',
  eta_breach: 'updated ticket in',
  stage_eta_breach: 'updated ticket in',
  paused_from_assignment: 'updated assignment in',
  resumed_from_assignment: 'updated assignment in',
  scheduled_call: 'scheduled a call in',
  call_reminder: 'reminded you about a scheduled call in',
  call_updated: 'updated a scheduled call in',
};

const getTimeLabel = (activity: ActivityWithRelated): string => {
  const date = new Date(activity.updatedAt ?? activity.createdAt);
  if (isToday(date)) return format(date, 'h:mm a');
  return formatDistanceToNowStrict(date, { addSuffix: false });
};

const getNavigationTarget = (activity: ActivityWithRelated): ActivityNavigationTarget => {
  const message = activity.message;
  const conversation = activity.message?.conversation;
  const shouldOpenThread = shouldOpenActivityThread({
    actorAction: activity.actorAction,
    ...(conversation?.conversationId ? { conversationId: conversation.conversationId } : {}),
    ...(conversation?.initialMessageId ? { initialMessageId: conversation.initialMessageId } : {}),
    ...(activity.isThreadActivity !== undefined
      ? { isThreadActivity: activity.isThreadActivity }
      : {}),
    ...(message?.messageId ? { messageId: message.messageId } : {}),
  });
  const ticketFromConversationMd = parseTicketMd(conversation?.ticket_md ?? null);
  const ticketId =
    activity.ticketId ??
    activity.ticket?.id ??
    conversation?.ticketId ??
    ticketFromConversationMd?.id ??
    null;
  if (ticketId && shouldOpenThread) {
    const channelId = conversation?.channelId ?? activity.channelId ?? undefined;
    const threadId = conversation?.conversationId ?? activity.conversationId ?? undefined;
    return {
      kind: 'ticket',
      ticketId,
      selectedTab: 'thread',
      ...(channelId ? { channelId } : {}),
      ...(threadId ? { threadId } : {}),
      ...(activity.message?.messageId ? { messageId: activity.message.messageId } : {}),
    };
  }

  if (ticketId && activity.ticket) {
    return {
      kind: 'ticket',
      ticketId,
      selectedTab: 'activity',
    };
  }

  if (message?.conversation) {
    return {
      kind: 'message',
      channelId: message.conversation.channelId,
      conversationId: message.conversation.conversationId,
      messageId: message.messageId,
      isThreadReply: shouldOpenThread,
      conversationCreatedAt: message.conversation.createdAt,
    };
  }

  const channelId = activity.ticket?.channelId;
  if (channelId) {
    return {
      kind: 'channel',
      channelId,
    };
  }

  return { kind: 'none' };
};

export const assembleActivityRowVm = ({
  activity,
  actorName,
  actorAvatarUrl,
  actorId,
  channel,
  currentUserId,
  users,
  channelLabel,
  description,
  navigationTarget,
}: AssembleActivityRowVmOptions): ActivityRowVM => {
  const action = activity.actorAction ?? '';
  const defaultActorId = actorId ?? activity.actorId ?? activity.message?.senderId ?? 'system';
  const resolvedActorName = actorName || (defaultActorId === 'system' ? 'Someone' : 'Loading…');
  const resolvedChannelLabel =
    channelLabel ??
    (channel && currentUserId
      ? getChannelDisplayName(channel, currentUserId, users)
      : (activity.message?.conversation?.channelId ??
        activity.ticket?.channelId ??
        activity.channelId ??
        undefined));

  return {
    id: activity.id,
    actorAction: action,
    isUnread: !activity.isRead,
    actorId: defaultActorId,
    actorName: resolvedActorName,
    actorAvatarUrl: actorAvatarUrl ?? '',
    channelId: activity.message?.conversation?.channelId ?? activity.ticket?.channelId ?? undefined,
    channelLabel: resolvedChannelLabel,
    description: description ?? DEFAULT_DESCRIPTION_BY_ACTION[action] ?? 'updated activity in',
    timeLabel: getTimeLabel(activity),
    navigationTarget: navigationTarget ?? getNavigationTarget(activity),
    messagePreviewKind:
      activity.message?.conversation &&
      activity.message.messageId === activity.message.conversation.initialMessageId
        ? 'conversation'
        : activity.message
          ? 'message'
          : 'none',
    activity,
  };
};
