import { useEffect, useMemo } from 'react';
import {
  ChannelScopeType,
  ChannelType,
  ChannelVisibility,
  type ChannelUserStatus,
} from '@xyne/shared';
import { searchChannels } from '@xyne/shared/utils';
import type { VisibleChannel } from '@/src/machines/stateMachine';
import { useAllChannels, useAllVisibleChannels, useUserChannelStatuses } from './useChannels';
import { ChannelListChannelRow, ChannelListRow } from '@/src/types/channel-list';
import { logger, Event } from '@/src/utils/logger';
import { buildListSyncPayload } from '@/src/utils/listSyncTelemetry';
import { useForegroundListSyncProbe } from './useForegroundListSyncProbe';
import { useAuth } from '@/src/contexts/AuthContext';
import { useListLiveUpdateProbe } from './useListLiveUpdateProbe';
import {
  getUnreadChannelActivityCounts,
  isUnreadChannelActivity,
} from '@/src/features/activity/domain/activitySelectors';
import { useActivityBadgeModel } from '@/src/features/activity/hooks/useActivityBadgeModel';
import {
  partitionChannelListRows,
  type ChannelFilterTab,
} from '@/src/components/chat/channel-list/channel-list.utils';
import { useChannelSections } from './useChannelSections';
import { useChannelGroupCollapse } from './useChannelGroupCollapse';
import {
  bucketChannelsBySection,
  buildGroupedChannelRows,
} from '@/src/components/chat/channel-list/section-utils';

const getLatestChannelActivityAt = (channels: readonly VisibleChannel[]): number =>
  channels.reduce(
    (latest, channel) => Math.max(latest, channel.channelStats?.lastActivityAt ?? 0),
    0,
  );

type UseChannelListResult = {
  rows: ChannelListRow[];
  channelCount: number;
  isEmpty: boolean;
  hasNoSearchResults: boolean;
};

type ChannelSearchCandidate = {
  id: string;
  name: string;
  visibility: ChannelVisibility;
  lastActivityAt?: number;
};

const MENTION_ACTIVITY_ACTIONS = new Set(['mentioned_user', 'group_mention']);

export function useChannelList(
  searchQuery = '',
  filterTab: ChannelFilterTab = 'all',
): UseChannelListResult {
  const { user } = useAuth();
  const currentUserId = user?.user_id ?? null;
  const visibleChannels = useAllVisibleChannels();
  const userChannelStatuses = useUserChannelStatuses();
  const highlightQuery = searchQuery.trim();
  const { unreadActivities } = useActivityBadgeModel();
  const { sections } = useChannelSections();
  const { isStarredCollapsed, isChannelsCollapsed } = useChannelGroupCollapse();
  const statusByChannelId = useMemo(
    () => new Map(userChannelStatuses.map(status => [status.channelId, status] as const)),
    [userChannelStatuses],
  );
  const channelUnreadCounts = useMemo(
    () => getUnreadChannelActivityCounts(unreadActivities, statusByChannelId),
    [statusByChannelId, unreadActivities],
  );

  const groupedWorkspaceChannels = useMemo(
    () => groupWorkspaceChannels(visibleChannels, userChannelStatuses),
    [visibleChannels, userChannelStatuses],
  );
  const workspaceChannels = useMemo(
    () => [...groupedWorkspaceChannels.starred, ...groupedWorkspaceChannels.channels],
    [groupedWorkspaceChannels],
  );

  const { consumeIfNewer: consumeForegroundSyncIfNewer } = useForegroundListSyncProbe({
    enabled: highlightQuery.length === 0 && currentUserId !== null,
    identityKey: currentUserId ? `channels_list:${currentUserId}` : null,
    getLatestItemAt: () => getLatestChannelActivityAt(workspaceChannels),
    getRowCount: () => workspaceChannels.length,
  });
  const channelsLiveUpdateIdentityKey =
    highlightQuery.length === 0 && currentUserId ? `channels_list:${currentUserId}` : null;
  const {
    arm: armLiveUpdateProbe,
    consumeIfNewer: consumeLiveUpdateIfNewer,
    isArmed: isLiveUpdateProbeArmed,
  } = useListLiveUpdateProbe();

  useEffect(() => {
    if (highlightQuery.length > 0) {
      return;
    }

    const latestItemAt = getLatestChannelActivityAt(workspaceChannels);
    const foregroundProbe = consumeForegroundSyncIfNewer(latestItemAt);
    if (foregroundProbe) {
      const completedAtMs = performance.now();
      logger.info(
        Event.LOTUS_LIST_SYNC,
        buildListSyncPayload({
          listType: 'channels_list',
          stage: 'foreground_sync',
          dataSource: 'zero_subscription',
          listStartedAtMs: foregroundProbe.startedAtMs,
          queryStartedAtMs: foregroundProbe.startedAtMs,
          completedAtMs,
          hadInitialData: foregroundProbe.cacheRowCount > 0,
          visibleRowCount: workspaceChannels.length,
          queryRowCount: visibleChannels.length,
          cacheRowCount: foregroundProbe.cacheRowCount,
          hasMore: false,
          filterTab: 'all',
          queryName: 'userVisibleChannelsV2',
        }),
      );
      return;
    }

    if (!channelsLiveUpdateIdentityKey) {
      return;
    }
    if (!isLiveUpdateProbeArmed(channelsLiveUpdateIdentityKey)) {
      armLiveUpdateProbe(
        channelsLiveUpdateIdentityKey,
        performance.now(),
        latestItemAt,
        workspaceChannels.length,
      );
      return;
    }

    const liveUpdateProbe = consumeLiveUpdateIfNewer(channelsLiveUpdateIdentityKey, latestItemAt);
    if (!liveUpdateProbe) {
      return;
    }

    const completedAtMs = performance.now();
    logger.info(
      Event.LOTUS_LIST_SYNC,
      buildListSyncPayload({
        listType: 'channels_list',
        stage: 'live_update',
        dataSource: 'zero_subscription',
        listStartedAtMs: liveUpdateProbe.startedAtMs,
        queryStartedAtMs: liveUpdateProbe.startedAtMs,
        completedAtMs,
        hadInitialData: liveUpdateProbe.cacheRowCount > 0,
        visibleRowCount: workspaceChannels.length,
        queryRowCount: visibleChannels.length,
        cacheRowCount: liveUpdateProbe.cacheRowCount,
        updatedRows: workspaceChannels.filter(
          channel => (channel.channelStats?.lastActivityAt ?? 0) > liveUpdateProbe.latestItemAt,
        ).length,
        hasMore: false,
        filterTab: 'all',
        queryName: 'userVisibleChannelsV2',
        latestItemAt,
        previousLatestItemAt: liveUpdateProbe.latestItemAt,
      }),
    );
  }, [
    armLiveUpdateProbe,
    channelsLiveUpdateIdentityKey,
    consumeForegroundSyncIfNewer,
    consumeLiveUpdateIfNewer,
    highlightQuery.length,
    isLiveUpdateProbeArmed,
    visibleChannels.length,
    workspaceChannels,
  ]);

  const allChannels = useAllChannels();

  const searchCandidateChannels = useMemo<ChannelSearchCandidate[]>(() => {
    const byId = new Map<string, ChannelSearchCandidate>();

    for (const channel of allChannels) {
      if (channel.type !== ChannelType.DEFAULT) continue;
      if (channel.scopeType !== ChannelScopeType.DEFAULT) continue;
      if (channel.visibility !== ChannelVisibility.PUBLIC) continue;
      if (channel.isArchived) continue;

      byId.set(channel.id, {
        id: channel.id,
        name: channel.name,
        visibility: channel.visibility,
        ...(channel.lastActivityAt !== undefined ? { lastActivityAt: channel.lastActivityAt } : {}),
      });
    }

    for (const channel of workspaceChannels) {
      if (channel.type !== ChannelType.DEFAULT) continue;
      if (channel.scopeType !== ChannelScopeType.DEFAULT) continue;

      byId.set(channel.id, {
        id: channel.id,
        name: channel.name,
        visibility: channel.visibility,
        ...(channel.channelStats?.lastActivityAt !== undefined
          ? { lastActivityAt: channel.channelStats.lastActivityAt }
          : {}),
      });
    }

    return [...byId.values()];
  }, [allChannels, workspaceChannels]);

  const rows = useMemo<ChannelListRow[]>(() => {
    if (highlightQuery.length > 0) {
      return searchChannels(
        searchCandidateChannels,
        highlightQuery,
        searchCandidateChannels.length,
      ).map(channel => {
        const status = statusByChannelId.get(channel.id);
        return {
          kind: 'channel' as const,
          id: channel.id,
          data: {
            id: channel.id,
            name: channel.name,
            visibility: channel.visibility,
            unreadCount: channelUnreadCounts.get(channel.id) ?? 0,
            messageUnreadCount: status?.unreadCount ?? 0,
            ...(status?.lastViewedAt !== undefined ? { lastViewedAt: status.lastViewedAt } : {}),
            ...(status?.lastViewedConversationId
              ? { lastViewedConversationId: status.lastViewedConversationId }
              : {}),
            ...(channel.lastActivityAt !== undefined
              ? { lastActivityAt: channel.lastActivityAt }
              : {}),
            highlightQuery,
          },
        };
      });
    }

    const sortedStarred = sortChannelsByUnreadAndActivity(
      groupedWorkspaceChannels.starred,
      channelUnreadCounts,
    );
    const sortedChannels = sortChannelsByUnreadAndActivity(
      groupedWorkspaceChannels.channels,
      channelUnreadCounts,
    );

    const filterChannels = (list: VisibleChannel[]): VisibleChannel[] =>
      highlightQuery ? searchChannels(list, highlightQuery, list.length) : list;

    const filteredStarred = filterChannels(sortedStarred);
    const filteredChannels = filterChannels(sortedChannels);
    const mentionedChannelIds = new Set(
      (unreadActivities ?? [])
        .filter(
          activity =>
            isUnreadChannelActivity(
              activity,
              activity.channelId
                ? statusByChannelId.get(activity.channelId)?.lastViewedAt
                : undefined,
            ) &&
            typeof activity.actorAction === 'string' &&
            MENTION_ACTIVITY_ACTIONS.has(activity.actorAction) &&
            typeof activity.channelId === 'string' &&
            activity.channelId.length > 0,
        )
        .map(activity => activity.channelId as string),
    );

    const toChannelRow = (channel: VisibleChannel): ChannelListChannelRow => {
      const status = statusByChannelId.get(channel.id);

      return {
        kind: 'channel',
        id: channel.id,
        data: {
          id: channel.id,
          name: channel.name,
          visibility: channel.visibility,
          unreadCount: channelUnreadCounts.get(channel.id) ?? 0,
          messageUnreadCount: status?.unreadCount ?? 0,
          ...(status?.lastViewedAt !== undefined ? { lastViewedAt: status.lastViewedAt } : {}),
          ...(status?.lastViewedConversationId
            ? { lastViewedConversationId: status.lastViewedConversationId }
            : {}),
          ...(channel.channelStats?.lastActivityAt !== undefined
            ? { lastActivityAt: channel.channelStats.lastActivityAt }
            : {}),
          ...(highlightQuery ? { highlightQuery } : {}),
        },
      };
    };

    if (filterTab !== 'all') {
      const partitioned = partitionChannelListRows(
        filteredStarred.map(toChannelRow),
        filteredChannels.map(toChannelRow),
        mentionedChannelIds,
      );
      return partitioned[filterTab];
    }

    /**
     * `bucketChannelsBySection` already answers `{ sectioned: [], unsectioned:
     * everything }` for a user with no sections, so the grouped layout covers
     * both cases through one path.
     *
     * Unread-first ordering now applies *within* each group rather than across
     * the whole list — set by `sortChannelsByUnreadAndActivity` above for
     * Starred, and by `sortChannelRowsByUnread` inside the builder for Channels.
     */
    const { sectioned, unsectioned } = bucketChannelsBySection(
      filteredChannels,
      userChannelStatuses,
      sections,
    );

    return buildGroupedChannelRows({
      starred: filteredStarred,
      sectioned,
      unsectioned,
      unreadCounts: channelUnreadCounts,
      isStarredCollapsed,
      isChannelsCollapsed,
      toChannelRow,
    });
  }, [
    isStarredCollapsed,
    isChannelsCollapsed,
    filterTab,
    groupedWorkspaceChannels,
    channelUnreadCounts,
    highlightQuery,
    searchCandidateChannels,
    statusByChannelId,
    unreadActivities,
    sections,
    userChannelStatuses,
  ]);

  const channelCount = rows.filter(r => r.kind === 'channel').length;

  return {
    rows,
    channelCount,
    isEmpty:
      highlightQuery.length > 0
        ? searchCandidateChannels.length === 0
        : workspaceChannels.length === 0,
    hasNoSearchResults: highlightQuery.length > 0 && channelCount === 0,
  };
}

type GroupedWorkspaceChannels = {
  starred: VisibleChannel[];
  channels: VisibleChannel[];
};

export function groupWorkspaceChannels(
  channelData: readonly VisibleChannel[],
  allChannelsUserStatus: readonly ChannelUserStatus[],
): GroupedWorkspaceChannels {
  const starred: VisibleChannel[] = [];
  const channels: VisibleChannel[] = [];
  const statusByChannelId = new Map(allChannelsUserStatus.map(s => [s.channelId, s] as const));

  for (const channel of channelData) {
    if (channel.type === ChannelType.EMAIL) continue;
    if (channel.scopeType !== ChannelScopeType.DEFAULT) continue;

    const status = statusByChannelId.get(channel.id);

    if (status?.isStarred) {
      starred.push(channel);
      continue;
    }

    channels.push(channel);
  }

  return { starred, channels };
}

export function sortChannelsByRecency(list: readonly VisibleChannel[]): VisibleChannel[] {
  return [...list].sort(
    (a, b) => (b.channelStats?.lastActivityAt ?? 0) - (a.channelStats?.lastActivityAt ?? 0),
  );
}

function sortChannelsByUnreadAndActivity(
  list: readonly VisibleChannel[],
  unreadCountByChannelId: ReadonlyMap<string, number>,
): VisibleChannel[] {
  const unread: VisibleChannel[] = [];
  const read: VisibleChannel[] = [];

  for (const channel of list) {
    const unreadCount = unreadCountByChannelId.get(channel.id) ?? 0;

    if (unreadCount > 0) {
      unread.push(channel);
    } else {
      read.push(channel);
    }
  }

  return [...sortChannelsByRecency(unread), ...sortChannelsByRecency(read)];
}
