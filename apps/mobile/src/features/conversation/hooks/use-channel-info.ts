import { useCallback, useMemo } from 'react';
import { useRouter, type Href } from 'expo-router';
import { ChannelScopeType } from '@xyne/shared';
import { useCanReadTicket, useUser, useUsersById } from '@xyne/shared/hooks';

import { useAuthContextValues } from '@/src/contexts/AuthContext';
import { canShowChannelTickets } from '@/src/features/channel-tickets/gate';
import { useChannelTicketsWarmup } from '@/src/features/channel-tickets/load';
import { nextChannelOverrideLevel } from '@/src/features/chat/channel-settings/channel-notifications';
import {
  initialTabForSurface,
  type SearchSourceSurface,
} from '@/src/features/global-search/utils/search-tabs';
import { useChannelSections } from '@/src/hooks/useChannelSections';
import { useGetChannelUserStatus } from '@/src/hooks/useChannels';
import { useConversationHeaderData } from '@/src/hooks/useConversationHeaderData';
import { useQuery } from '@/src/hooks/useQuery';
import { useZero } from '@/src/hooks/useZero';
import { mutators } from '@/src/zero/mutators';
import { queries } from '@/src/zero/queries';

import { CHANNEL_INFO_MAX_FACES } from '../constants';
import {
  canPickSection,
  channelInfoActions,
  channelInfoContentRows,
  channelInfoSubtitle,
  createdLine,
  isChannelMuted,
  membersSummary,
  sectionLabel,
  type ChannelInfoActionId,
  type ChannelInfoContentRowId,
} from '../model/channel-info';
import { roomKindOf, type RoomKind } from '../model/room-title';

/** The classic info screen's sub-routes, all keyed by the channel id. */
type ChannelSubRoute =
  | '/(protected)/chat/[channelId]/about'
  | '/(protected)/chat/[channelId]/members'
  | '/(protected)/chat/[channelId]/files'
  | '/(protected)/chat/[channelId]/pinned-messages'
  | '/(protected)/chat/[channelId]/canvas'
  | '/(protected)/chat/[channelId]/links'
  | '/(protected)/chat/[channelId]/tickets'
  | '/(protected)/chat/[channelId]/settings';

const CONTENT_ROUTES: Readonly<Record<ChannelInfoContentRowId, ChannelSubRoute>> = {
  files: '/(protected)/chat/[channelId]/files',
  tickets: '/(protected)/chat/[channelId]/tickets',
  pinned: '/(protected)/chat/[channelId]/pinned-messages',
  canvas: '/(protected)/chat/[channelId]/canvas',
  links: '/(protected)/chat/[channelId]/links',
};

export type ChannelInfoModel = {
  kind: RoomKind;
  /** The bare name: the tile already says it is a channel. */
  name: string;
  subtitle: string;
  description: string | null;
  isPrivateChannel: boolean;
  /** The other person (or yourself) in a one-to-one chat. */
  dmUserId: string | null;
  isOnline: boolean;
  dmStatusEmoji: string | null;
  dmStatusContent: string | null;
  actions: ChannelInfoActionId[];
  isMuted: boolean;
  /** Star and section need membership, as in the classic screen. */
  canStar: boolean;
  isStarred: boolean;
  /** Null hides the Section row. */
  section: string | null;
  /** Up to three faces for the members row, others before yourself. */
  memberFaces: string[];
  membersLabel: string;
  contentRows: ChannelInfoContentRowId[];
  created: string | null;
  canPromoteToChannel: boolean;
  canLeaveChannel: boolean;
  currentSectionId: string | null;
  sections: readonly { id: string; name: string }[];
  onSearch: () => void;
  onCall: () => void;
  onToggleMute: () => void;
  onToggleStar: () => void;
  onMoveToSection: (sectionId: string | null) => void;
  onOpenMembers: () => void;
  onOpenContent: (id: ChannelInfoContentRowId) => void;
  onOpenAbout: () => void;
  onOpenSettings: () => void;
  onOpenAvatar: () => void;
  onLeave: () => void;
};

/**
 * Everything the redesigned info screen shows and does. The data, permissions
 * and actions are the classic screen's (`useConversationHeaderData`, its
 * routes and tickets gate); Mute and Section reuse the mutations the Settings
 * screen and the channel list already make.
 */
export function useChannelInfo(channelId: string): ChannelInfoModel {
  const router = useRouter();
  const zero = useZero();
  const { userID: currentUserId } = useAuthContextValues();
  const header = useConversationHeaderData(channelId);
  const {
    channel,
    displayName,
    isDM,
    dmProfileUserId,
    memberCount,
    canUseMemberActions,
    handleCallPress,
  } = header;
  const kind = roomKindOf(channel?.scopeType);

  const status = useGetChannelUserStatus(channelId);
  const isMember = status !== undefined;
  const isMuted = isChannelMuted(status ?? null);
  const { sections, addChannelsToSection, removeChannelsFromSection } = useChannelSections();
  const showSection = canPickSection(channel?.scopeType, isMember);

  // Same query the header data runs, so this subscribes to the rows it already loaded.
  const [participants] = useQuery(queries.channelParticipants({ channelId }), {
    enabled: !isDM,
  });
  const usersById = useUsersById();
  const memberFaces = useMemo(() => {
    const ids = (participants ?? []).map(participant => participant.userId);
    const others = ids.filter(id => id !== currentUserId);
    return (others.length > 0 ? others : ids).slice(0, CHANNEL_INFO_MAX_FACES);
  }, [currentUserId, participants]);
  const memberNames = memberFaces.map(id => usersById.get(id)?.name ?? '');

  const creator = useUser(channel?.createdBy ?? '');

  const canReadTicket = useCanReadTicket();
  const showTickets = canShowChannelTickets(channel, canReadTicket);
  useChannelTicketsWarmup(channelId, showTickets);

  const push = useCallback(
    (pathname: ChannelSubRoute): void => router.push({ pathname, params: { channelId } }),
    [channelId, router],
  );

  /** The classic screen's search: global search locked to this conversation. */
  const onSearch = useCallback((): void => {
    const sourceSurface: SearchSourceSurface =
      isDM || channel?.scopeType === ChannelScopeType.GROUP_DM ? 'dms' : 'channels';
    router.push({
      pathname: '/(protected)/global-search',
      params: {
        sourceSurface,
        initialTab: initialTabForSurface(sourceSurface),
        scopeChannelId: channelId,
        scopeLabel: displayName,
      },
    } as unknown as Href);
  }, [channel?.scopeType, channelId, displayName, isDM, router]);

  const onToggleMute = useCallback((): void => {
    // Unmuting returns both deliveries to the user's defaults, as the Settings switches do.
    const level = nextChannelOverrideLevel(isMuted);
    void zero.mutate(
      mutators.notificationSettings.setChannelNotificationLevel({
        channelId,
        desktopNotificationLevel: level,
        mobileNotificationLevel: level,
        timestamp: Date.now(),
      }),
    );
  }, [channelId, isMuted, zero]);

  const onMoveToSection = useCallback(
    (sectionId: string | null): void => {
      if (sectionId === null) removeChannelsFromSection([channelId]);
      else addChannelsToSection([channelId], sectionId);
    },
    [addChannelsToSection, channelId, removeChannelsFromSection],
  );

  const onOpenMembers = useCallback((): void => {
    if (!isDM) {
      push('/(protected)/chat/[channelId]/members');
      return;
    }
    if (dmProfileUserId) router.push(`/profile/${dmProfileUserId}`);
  }, [dmProfileUserId, isDM, push, router]);

  const onOpenAvatar = useCallback((): void => {
    if (!dmProfileUserId) return;
    router.push({
      pathname: '/(protected)/settings/profile-photo',
      params: { userId: dmProfileUserId },
    });
  }, [dmProfileUserId, router]);

  const description = channel?.description?.trim();

  return {
    kind,
    name: displayName,
    subtitle: channelInfoSubtitle(kind, header.isPrivateChannel, memberCount),
    description: description ? description : null,
    isPrivateChannel: kind === 'channel' && header.isPrivateChannel,
    dmUserId: isDM ? dmProfileUserId : null,
    isOnline: header.isOnline,
    dmStatusEmoji: header.dmStatusEmoji ?? null,
    dmStatusContent: header.dmStatusContent ?? null,
    actions: channelInfoActions({ canAddPeople: header.canAddPeople, canMute: isMember }),
    isMuted,
    canStar: canUseMemberActions,
    isStarred: header.isStarred,
    section: showSection ? sectionLabel(sections, status?.sectionId) : null,
    memberFaces: isDM ? [] : memberFaces,
    membersLabel: membersSummary(memberNames, memberCount),
    contentRows: channelInfoContentRows(showTickets),
    created: createdLine(channel?.createdAt, creator?.name),
    canPromoteToChannel: header.canPromoteToChannel,
    canLeaveChannel: header.canLeaveChannel,
    currentSectionId: status?.sectionId ?? null,
    sections,
    onSearch,
    onCall: () => void handleCallPress(),
    onToggleMute,
    onToggleStar: header.handleStarToggle,
    onMoveToSection,
    onOpenMembers,
    onOpenContent: id => push(CONTENT_ROUTES[id]),
    onOpenAbout: () => push('/(protected)/chat/[channelId]/about'),
    onOpenSettings: () => push('/(protected)/chat/[channelId]/settings'),
    onOpenAvatar,
    onLeave: header.handleLeaveChannel,
  };
}
