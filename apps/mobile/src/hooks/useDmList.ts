import { searchChannels } from '@xyne/shared/utils';
import { useUsers } from './useUsers';
import { useAllUnreadCount } from './useChannels';
import { useSelector } from '@xstate/react';
import { stateMachineActor } from '@xyne/shared/machines';
import { useDmsPaginatedMessages } from './useDmsPaginatedMessagesV2';
import { useStarredDms } from './useStarredDms';
import { useCallback, useMemo, useRef } from 'react';
import { DmListItemData } from '@/src/types/dm-list-item';
import type { DmListParticipantIdentity } from '@/src/types/dm-list-item';
import {
  filterDmListItems,
  mergeStarredDmChannels,
  type DmFilterTab,
} from '@/src/utils/dm-list-filters';
import { getDmAvatarUserIds, getUserDisplayName, isSelfDmChannel } from '@/src/utils/channel-utils';
import { ChannelScopeType } from '@xyne/shared';
import { getActiveUserStatusEmoji } from '@/src/utils/statusUtils';
import {
  createDmRowCache,
  getCachedDmMessage,
  pruneDmRowCache,
  reconcileDmRow,
  type DmRowCache,
} from '@/src/utils/dm-list-row-cache';
import { useSharedAuthContext } from '@xyne/shared/hooks';
import { useAuth } from '@/src/contexts/AuthContext';
import { useCachedQuery } from '@/src/hooks/useCachedQuery';
import { queries } from '@/src/zero/queries';

export type { DmFilterTab } from '@/src/utils/dm-list-filters';

const sortDmListItems = (items: DmListItemData[]): DmListItemData[] => {
  const starred: DmListItemData[] = [];
  const rest: DmListItemData[] = [];
  for (const item of items) {
    if (item.isStarred) starred.push(item);
    else rest.push(item);
  }
  const byActivity = (a: DmListItemData, b: DmListItemData): number =>
    (b.lastActivityAtMs ?? 0) - (a.lastActivityAtMs ?? 0);
  starred.sort(byActivity);
  rest.sort(byActivity);
  return [...starred, ...rest];
};

// A starred DM with no loaded conversation still needs a subtitle. Module-level
// so the identity is stable and row reconciliation sees no change.
const DM_STARRED_PLACEHOLDER_PREVIEW = {
  variant: 'text' as const,
  text: 'Direct message',
};

const getStringValue = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const buildParticipantIdentities = (
  participantUserIds: readonly string[],
  usersById: ReadonlyMap<string, ReturnType<typeof useUsers>[number]>,
): DmListParticipantIdentity[] | undefined => {
  const identities: DmListParticipantIdentity[] = [];

  for (const id of participantUserIds) {
    const user = usersById.get(id);
    if (user) {
      const name = getStringValue(user.name);
      const displayName = getStringValue(user.displayName);
      const identity: DmListParticipantIdentity = { id };
      if (name) identity.name = name;
      if (displayName) identity.displayName = displayName;
      if (user.picture !== undefined) identity.picture = user.picture;
      identities.push(identity);
    }
  }

  return identities.length > 0 ? identities : undefined;
};

const isDmScope = (
  scopeType: ChannelScopeType,
): scopeType is ChannelScopeType.DM | ChannelScopeType.GROUP_DM =>
  scopeType === ChannelScopeType.DM || scopeType === ChannelScopeType.GROUP_DM;

const getDisplayNameFromSources = (
  userId: string | undefined,
  usersById: ReadonlyMap<string, ReturnType<typeof useUsers>[number]>,
): string | undefined => {
  if (!userId) {
    return undefined;
  }

  const user = usersById.get(userId);
  return (
    getStringValue(user?.displayName) ?? getStringValue(user?.name) ?? getStringValue(user?.email)
  );
};

const getDmListTitle = (
  channel: { name: string; scopeType: ChannelScopeType },
  currentUserId: string,
  usersById: ReadonlyMap<string, ReturnType<typeof useUsers>[number]>,
): string => {
  if (!isDmScope(channel.scopeType)) {
    return channel.name;
  }

  const participantUserIds = getDmAvatarUserIds(channel, currentUserId);

  if (channel.scopeType === ChannelScopeType.DM) {
    if (isSelfDmChannel(channel, currentUserId)) {
      const selfName = getDisplayNameFromSources(currentUserId, usersById);
      return selfName ? `${selfName} (you)` : 'You';
    }

    // An unresolved identity is represented by the row skeleton until the
    // cached or live user record arrives. Never show a misleading generic
    // title while the DM list is still hydrating.
    return getDisplayNameFromSources(participantUserIds[0], usersById) ?? '';
  }

  const resolvedNames = participantUserIds
    .slice(0, 4)
    .map(id => getDisplayNameFromSources(id, usersById))
    .filter((name): name is string => name !== undefined);

  if (resolvedNames.length === 0) return '';
  if (participantUserIds.length <= 3) {
    return resolvedNames.join(', ');
  }
  if (resolvedNames.length >= 3) {
    const remaining = participantUserIds.length - 3;
    return `${resolvedNames.slice(0, 3).join(', ')} and ${remaining} other${
      remaining > 1 ? 's' : ''
    }`;
  }

  const unresolvedCount = participantUserIds.length - resolvedNames.length;
  return `${resolvedNames.join(', ')} and ${unresolvedCount} other${
    unresolvedCount > 1 ? 's' : ''
  }`;
};

export type UseDmListOptions = {
  searchQuery?: string;
  filterTab?: DmFilterTab;
  liveDataEnabled?: boolean;
};

type UseDmListResult = {
  items: DmListItemData[];
  loadMore: () => void;
  hasMore: boolean;
  isLoading: boolean;
  hasLoadError: boolean;
  isLoadingMore: boolean;
  isSearching: boolean;
  isFiltering: boolean;
  isEmpty: boolean;
  unreadDmCount: number;
  hasCachedData: boolean;
  isListSyncComplete: boolean;
};

export const useDmList = ({
  searchQuery = '',
  filterTab = 'all',
  liveDataEnabled = true,
}: UseDmListOptions = {}): UseDmListResult => {
  const { userID: sharedUserID } = useSharedAuthContext();
  const { user } = useAuth();
  const userID = user?.user_id ?? sharedUserID;
  const workspaceId = user?.workspaceId ?? null;
  const users = useUsers();
  const usersQuery = useMemo(() => queries.getUsersV2(), []);
  const [cachedUsers] = useCachedQuery(usersQuery, {
    // useCachedQuery still reads the actor/IDB cache when disabled. Keep the
    // Zero query off here so DM identity lookup cannot add a live subscription
    // or wait on network work that is unrelated to rendering the row.
    enabled: false,
  });
  const cachedUsersForWorkspace = useMemo(
    () =>
      workspaceId
        ? (cachedUsers ?? []).filter(candidate => candidate.workspaceId === workspaceId)
        : [],
    [cachedUsers, workspaceId],
  );
  const unreadCounts = useAllUnreadCount();
  const starredDms = useStarredDms(filterTab === 'starred');
  const userChannelStatuses = useSelector(
    stateMachineActor,
    state => state.context.userChannelStatuses,
  );
  const visibleChannelIdSet = useMemo(
    () => new Set(userChannelStatuses.map(status => status.channelId)),
    [userChannelStatuses],
  );

  const {
    channels,
    messagesMap,
    loadMore,
    hasMore,
    isLoading,
    isLoadingMore,
    isLiveReady,
    initialSyncStatus,
  } = useDmsPaginatedMessages({
    liveDataEnabled,
    currentUserId: userID,
    workspaceId,
    filterTab: filterTab === 'starred' ? 'all' : filterTab,
    unreadCounts,
  });

  const channelsForDisplay = useMemo(() => {
    if (filterTab !== 'starred') {
      return channels;
    }
    return mergeStarredDmChannels(channels, starredDms);
  }, [channels, filterTab, starredDms]);

  const starredDmChannelIds = useMemo(
    () => new Set(starredDms.map(entry => entry.channelId)),
    [starredDms],
  );

  const liveUsersById = useMemo(() => {
    const map = new Map<string, (typeof users)[number]>();
    for (const user of users) {
      if (!workspaceId || user.workspaceId === workspaceId) {
        map.set(user.id, user);
      }
    }
    return map;
  }, [users, workspaceId]);

  const usersById = useMemo(() => {
    if (cachedUsersForWorkspace.length === 0) {
      return liveUsersById;
    }

    // Keep the live directory authoritative and only fill identities that it
    // has not hydrated yet from the persisted cache.
    const map = new Map(liveUsersById);
    for (const cachedUser of cachedUsersForWorkspace) {
      if (!map.has(cachedUser.id)) {
        map.set(cachedUser.id, cachedUser);
      }
    }
    return map;
  }, [cachedUsersForWorkspace, liveUsersById]);

  const statusByChannelId = useMemo(() => {
    const map = new Map<string, (typeof userChannelStatuses)[number]>();
    for (const status of userChannelStatuses) {
      map.set(status.channelId, status);
    }
    return map;
  }, [userChannelStatuses]);

  // Held in a ref, not state: it is a derivation cache, never a render input.
  // liveItems stays a pure function of its deps, so a discarded concurrent
  // render cannot corrupt it.
  const rowCacheRef = useRef<DmRowCache | null>(null);
  rowCacheRef.current ??= createDmRowCache();
  const rowCache = rowCacheRef.current;

  const liveItems = useMemo(() => {
    const rows: DmListItemData[] = [];
    const liveChannelIds = new Set<string>();

    for (const channel of channelsForDisplay) {
      const channelStatus = statusByChannelId.get(channel.id);
      // Archived DMs drop out of userVisibleChannelsV2; missing status means not visible.
      if (visibleChannelIdSet.size > 0 && (!channelStatus || channelStatus.isClosed)) {
        continue;
      }

      const participantUserIds = getDmAvatarUserIds(channel, userID);
      const participantIdentities = buildParticipantIdentities(participantUserIds, usersById);
      const conversation = messagesMap.get(channel.id);

      const {
        summary,
        lastMessage: messagePreview,
        timestampLabel,
      } = getCachedDmMessage(rowCache, channel.id, conversation, userID, resolvedSummary => {
        const senderId = resolvedSummary?.senderId;
        if (!senderId || senderId === userID) return undefined;
        const sender = usersById.get(senderId);
        return sender ? getUserDisplayName(sender) : undefined;
      });

      const lastMessage =
        conversation === undefined && starredDmChannelIds.has(channel.id)
          ? DM_STARRED_PLACEHOLDER_PREVIEW
          : messagePreview;

      const unreadCount = unreadCounts[channel.id] ?? 0;
      const statusUserId =
        channel.scopeType === ChannelScopeType.GROUP_DM ? undefined : participantUserIds[0];
      const statusEmoji = statusUserId
        ? getActiveUserStatusEmoji(usersById.get(statusUserId))
        : undefined;

      liveChannelIds.add(channel.id);
      rows.push(
        reconcileDmRow(rowCache, {
          id: channel.id,
          title: getDmListTitle(channel, userID, usersById),
          participantUserIds,
          ...(participantIdentities ? { participantIdentities } : {}),
          scopeType: channel.scopeType as ChannelScopeType.DM | ChannelScopeType.GROUP_DM,
          lastMessage,
          timestampLabel,
          ...(unreadCount > 0 ? { unreadCount } : {}),
          ...(channelStatus?.lastViewedAt !== undefined
            ? { lastViewedAt: channelStatus.lastViewedAt }
            : {}),
          ...(channelStatus?.lastViewedConversationId
            ? { lastViewedConversationId: channelStatus.lastViewedConversationId }
            : {}),
          isLastMessageOutgoing: summary?.senderId === userID,
          isStarred: channelStatus?.isStarred ?? false,
          lastActivityAtMs: channel.channelStats?.lastActivityAt ?? 0,
          ...(statusEmoji ? { statusEmoji } : {}),
        }),
      );
    }

    pruneDmRowCache(rowCache, liveChannelIds);
    return sortDmListItems(rows);
  }, [
    channelsForDisplay,
    messagesMap,
    rowCache,
    starredDmChannelIds,
    statusByChannelId,
    unreadCounts,
    userID,
    usersById,
    visibleChannelIdSet,
  ]);

  const allItems = liveItems;

  const unreadDmCount = useMemo(
    () => allItems.reduce((acc, item) => acc + ((item.unreadCount ?? 0) > 0 ? 1 : 0), 0),
    [allItems],
  );

  const tabFilteredItems = useMemo(
    () => filterDmListItems(allItems, filterTab),
    [allItems, filterTab],
  );

  const normalizedSearchQuery = searchQuery.trim();

  const items = useMemo(() => {
    if (!normalizedSearchQuery) {
      return tabFilteredItems;
    }
    const searchableRows = tabFilteredItems.map(item => ({ name: item.title, item }));
    return searchChannels(searchableRows, normalizedSearchQuery, searchableRows.length).map(
      match => match.item,
    );
  }, [tabFilteredItems, normalizedSearchQuery]);

  const hasDisplayData = allItems.length > 0;
  const isHydratingDisplay = channels.length > 0 && !hasDisplayData;
  const hasLoadError = initialSyncStatus === 'error' && !hasDisplayData;
  const showLoading = (isLoading || isHydratingDisplay) && !hasDisplayData && !hasLoadError;
  const loadMoreItems = useCallback(() => {
    if (filterTab === 'starred') return;
    loadMore();
  }, [filterTab, loadMore]);

  return {
    items,
    loadMore: loadMoreItems,
    hasMore: filterTab === 'starred' ? false : hasMore,
    isLoading: showLoading,
    hasLoadError,
    isLoadingMore: filterTab === 'starred' ? false : isLoadingMore,
    isSearching: normalizedSearchQuery.length > 0,
    isFiltering: filterTab !== 'all',
    isEmpty: allItems.length === 0,
    unreadDmCount,
    hasCachedData: hasDisplayData,
    isListSyncComplete: initialSyncStatus === 'complete' || isLiveReady,
  };
};
