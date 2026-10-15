import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useSelector } from '@xstate/react';
import {
  ChannelAddUserPolicy,
  ChannelRole,
  ChannelScopeType,
  ChannelVisibility,
} from '@xyne/shared';

import { useAuthContextValues } from '@/src/contexts/AuthContext';
import { resolveChannelMemberCount } from '@/src/features/chat/channel-members/channel-member-actions';
import { canPromoteConversationToChannel } from '@/src/features/chat/promoteToChannelPolicy';
import { useChannelDisplayName, useVisibleChannel } from '@/src/hooks/useChannels';
import { useUserPresence } from '@/src/hooks/usePresence';
import { useCurrentCallExternalId, useIsInCall } from '@/src/hooks/useRoomMachine';
import { useSelf, useUser } from '@/src/hooks/useUsers';
import { useQuery } from '@/src/hooks/useQuery';
import { useZero } from '@/src/hooks/useZero';
import { stateMachineActor } from '@/src/machines/appStateMachine';
import { reportNotificationHeaderResolve } from '@/src/observability/logging/notification/reportNotificationHeaderResolve';
import {
  getNotificationHeaderResolveChannelId,
  subscribeNotificationHeaderResolveSnapshot,
} from '@/src/observability/logging/notification/notificationHeaderResolve';
import {
  getNotificationOpenJourneyId,
  subscribeNotificationOpenJourney,
} from '@/src/observability/logging/notification/notificationOpen';
import { useStartupPhase } from '@/src/providers/StartupPhaseProvider';
import { classifyConversationHeaderTitle, getChannelNameUsersMap } from '@/src/utils/channel-utils';
import { getActiveUserStatusContent, getActiveUserStatusEmoji } from '@/src/utils/statusUtils';
import { startAudioCall } from '@/src/utils/startAudioCall';
import { openBaseConversationListRoute } from '@/src/utils/openChatRoute';
import { mutators } from '@/src/zero/mutators';
import { queries } from '@/src/zero/queries';

const getOtherUserIdFromDM = (
  channel: { name: string; scopeType?: string } | undefined,
  currentUserId: string,
): string | null => {
  if (!channel || channel.scopeType !== ChannelScopeType.DM) return null;
  const ids = channel.name
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  return ids.find(id => id !== currentUserId) ?? null;
};

export type UseConversationHeaderDataOptions = {
  /** Gate the participants query (mirrors chat-header-v3's postPaintReady deferral). Defaults to true. */
  enabled?: boolean;
};

/**
 * Shared derived state + actions for a conversation's header/info surfaces
 * (collapsed pill in ChatHeaderV3 and the full-page conversation info screen).
 * Kept in one place so the two can't drift apart on gating rules.
 */
export const useConversationHeaderData = (
  channelId: string,
  options: UseConversationHeaderDataOptions = {},
) => {
  const { enabled = true } = options;
  const router = useRouter();
  const { userID: currentUserId } = useAuthContextValues();
  const isInCall = useIsInCall();
  const currentCallExternalId = useCurrentCallExternalId();

  const { isVisibleChannelsReady, isUserDirectoryReady } = useStartupPhase();
  const channel = useVisibleChannel(channelId);
  const displayName = useChannelDisplayName(channel, currentUserId);
  const users = useSelector(stateMachineActor, state => state.context.users);
  const usersById = getChannelNameUsersMap(users);
  const notificationHeaderChannelId = useSyncExternalStore(
    subscribeNotificationHeaderResolveSnapshot,
    getNotificationHeaderResolveChannelId,
    getNotificationHeaderResolveChannelId,
  );
  const titleStatus = classifyConversationHeaderTitle({
    channel,
    currentUserId,
    usersById,
    visibleChannelsReady: isVisibleChannelsReady,
    usersReady: isUserDirectoryReady,
    holdAbsentChannel: notificationHeaderChannelId === channelId && channel == null,
  });
  const isTitlePending = titleStatus === 'pending';
  const channelPresentInVisibleChannels = channel != null;
  const headerScopeType = channel?.scopeType ?? null;
  const notificationOpenJourneyId = useSyncExternalStore(
    subscribeNotificationOpenJourney,
    getNotificationOpenJourneyId,
    getNotificationOpenJourneyId,
  );

  useEffect(() => {
    if (!channelId) return;
    reportNotificationHeaderResolve({
      channelId,
      headerStatus: titleStatus,
      channelPresentInVisibleChannels,
      visibleChannelListPublished: isVisibleChannelsReady,
      userDirectoryPublished: isUserDirectoryReady,
      scopeType: headerScopeType,
    });
  }, [
    channelId,
    channelPresentInVisibleChannels,
    headerScopeType,
    isUserDirectoryReady,
    isVisibleChannelsReady,
    notificationOpenJourneyId,
    titleStatus,
  ]);

  const otherUserId = getOtherUserIdFromDM(channel, currentUserId);
  const otherUser = useUser(otherUserId ?? '');
  const selfUser = useSelf();
  const [participants] = useQuery(queries.channelParticipants({ channelId }), { enabled });

  const isSelfDm =
    channel?.scopeType === ChannelScopeType.DM &&
    channel?.name
      .split(',')
      .map(s => s.trim())
      .filter(Boolean).length === 1 &&
    channel?.name.includes(currentUserId);

  const isChannel =
    channel?.scopeType === ChannelScopeType.DEFAULT ||
    channel?.scopeType === ChannelScopeType.GROUP_DM;
  const isDM = channel?.scopeType === ChannelScopeType.DM;
  const isPrivateChannel = channel?.visibility === ChannelVisibility.PRIVATE;

  const dmProfileUserId = isSelfDm ? currentUserId : otherUserId;
  const dmAvatarUser = isDM ? (isSelfDm ? selfUser : otherUser) : undefined;
  const dmStatusEmoji = getActiveUserStatusEmoji(dmAvatarUser);
  const dmStatusContent = getActiveUserStatusContent(dmAvatarUser);
  const { isOnline } = useUserPresence(isDM && dmProfileUserId ? dmProfileUserId : '');

  const userChannelStatuses = useSelector(
    stateMachineActor,
    state => state.context.userChannelStatuses,
  );
  const channelStatus = userChannelStatuses.find(s => s.channelId === channelId);
  const isStarred = channelStatus?.isStarred ?? false;

  const memberCount = resolveChannelMemberCount({
    liveParticipantCount: participants?.length ?? 0,
    statsParticipantCount: channel?.channelStats?.participantCount,
  });
  const memberLabel = memberCount === 1 ? 'member' : 'members';

  const currentUserParticipant = participants?.find(p => p.userId === currentUserId);
  const isParticipant = !!currentUserParticipant;
  const addUserPolicy = channel?.channelStats?.addUserPolicy ?? ChannelAddUserPolicy.EVERYONE;
  const canAddPeople =
    isParticipant &&
    !isDM &&
    (channel?.scopeType === ChannelScopeType.GROUP_DM ||
      currentUserParticipant?.role === ChannelRole.ADMIN ||
      addUserPolicy === ChannelAddUserPolicy.EVERYONE);

  const canPromoteToChannel = canPromoteConversationToChannel({
    scopeType: channel?.scopeType,
    isParticipant,
  });

  const isMember = Boolean(channelStatus);
  const canUseMemberActions = isDM || isMember;
  const canLeaveChannel = channel?.scopeType === ChannelScopeType.DEFAULT && isMember;

  const zero = useZero();

  const handleStarToggle = useCallback(() => {
    if (!canUseMemberActions) return;
    zero.mutate(mutators.channel.toggleStarred({ channelId, updatedAt: Date.now() }));
  }, [canUseMemberActions, zero, channelId]);

  const handleCallPress = useCallback(async () => {
    if (!canUseMemberActions) {
      Alert.alert('Join channel', 'Join this channel before starting a call.');
      return;
    }

    const isUserInThisCall = currentCallExternalId === channelId;
    if (isInCall && !isUserInThisCall) {
      Alert.alert('Already in a call', 'Please leave your current call before starting a new one.');
      return;
    }
    await startAudioCall(channelId);
  }, [canUseMemberActions, channelId, isInCall, currentCallExternalId]);

  const handleLeaveChannel = useCallback(() => {
    if (!canLeaveChannel) return;

    Alert.alert('Leave channel?', `You will be removed from #${displayName}.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: (): void => {
          void zero.mutate(mutators.channel.leaveChannel({ channelId, updatedAt: Date.now() }));
          openBaseConversationListRoute(router, 'channels');
        },
      },
    ]);
  }, [canLeaveChannel, channelId, displayName, router, zero]);

  return {
    channel,
    displayName,
    isTitlePending,
    isDM,
    isChannel,
    isPrivateChannel,
    isSelfDm,
    dmProfileUserId,
    dmStatusEmoji,
    dmStatusContent,
    isOnline,
    memberCount,
    memberLabel,
    canAddPeople,
    canPromoteToChannel,
    canUseMemberActions,
    canLeaveChannel,
    isStarred,
    handleStarToggle,
    handleCallPress,
    handleLeaveChannel,
  };
};
