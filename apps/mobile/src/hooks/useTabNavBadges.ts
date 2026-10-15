import { useMemo } from 'react';
import { useSelector } from '@xstate/react';
import { ChannelScopeType } from '@xyne/shared';
import { useSegments } from 'expo-router';

import { stateMachineActor } from '@/src/machines/appStateMachine';
import { useCachedQuery } from '@/src/hooks/useCachedQuery';
import { useDeferredLiveData } from '@/src/hooks/useDeferredLiveData';
import { useZero } from '@/src/hooks/useZero';
import { queries } from '@/src/zero/queries';
import { groupChannelsByScope } from '@/src/utils/chatDirectory';
import { useActivityBadgeModel } from '@/src/features/activity/hooks/useActivityBadgeModel';
import { formatCountLabel } from '@/src/utils/countLabel';
import {
  getUnreadChannelActivityCounts,
  selectActivitiesForWorkspace,
} from '@/src/features/activity/domain/activitySelectors';

export type TabNavBadgeCounts = {
  channels: number;
  dms: number;
  activity: number;
  calls: number;
};

const CALL_BADGE_QUERY_DELAY_MS = 4_000;
const EMPTY_BADGES: TabNavBadgeCounts = {
  channels: 0,
  dms: 0,
  activity: 0,
  calls: 0,
};

export function hasTabBadge(count: number): boolean {
  return count > 0;
}

export function formatTabBadgeLabel(count: number): string | undefined {
  if (!hasTabBadge(count)) {
    return undefined;
  }
  return formatCountLabel(count);
}

/** Unread counts for main tab bar badges (channels, DMs, activity, calls). */
export function useTabNavBadges(): TabNavBadgeCounts {
  const segments = useSegments();
  const workspaceId = useZero().context.workspaceId;
  const isCallsTabActive = segments.some(segment => segment === 'calls');
  const liveCallsBadgeEnabled = useDeferredLiveData({
    name: 'tab_call_badge',
    screen: 'tabs',
    hasInitialData: false,
    delayMs: CALL_BADGE_QUERY_DELAY_MS,
    timeoutMs: 2_000,
    enabled: isCallsTabActive,
  });
  const userChannelStatuses = useSelector(
    stateMachineActor,
    state => state.context.userChannelStatuses,
  );
  const visibleChannels = useSelector(stateMachineActor, state => state.context.visibleChannels);
  const [missedCalls, missedCallsDetails] = useCachedQuery(queries.userMissedCalls(), {
    enabled: isCallsTabActive && liveCallsBadgeEnabled,
    ttl: '10m',
  });
  const workspaceMissedCalls = useMemo(
    () => selectActivitiesForWorkspace(missedCalls, workspaceId),
    [missedCalls, workspaceId],
  );

  const activityBadgeModel = useActivityBadgeModel();

  const liveChannelBadges = useMemo(() => {
    const statusByChannelId = new Map(userChannelStatuses.map(s => [s.channelId, s]));
    const channelUnreadCounts = getUnreadChannelActivityCounts(
      activityBadgeModel.unreadActivities,
      statusByChannelId,
    );
    const channelsList = visibleChannels ?? [];

    const { starred, channels, directMessages } = groupChannelsByScope(
      channelsList,
      userChannelStatuses,
    );

    const defaultChannels = [
      ...starred.filter(ch => ch.scopeType === ChannelScopeType.DEFAULT),
      ...channels,
    ];

    let channelsBadge = 0;
    for (const channel of defaultChannels) {
      if ((channelUnreadCounts.get(channel.id) ?? 0) > 0) {
        channelsBadge += 1;
      }
    }

    let dmsBadge = 0;
    for (const channel of directMessages) {
      const status = statusByChannelId.get(channel.id);
      if ((status?.unreadCount ?? 0) > 0) {
        dmsBadge += 1;
      }
    }

    return {
      channels: channelsBadge,
      dms: dmsBadge,
    };
  }, [activityBadgeModel.unreadActivities, visibleChannels, userChannelStatuses]);

  const hasLiveCallsBadgeSource = missedCallsDetails.type === 'complete';

  const badges = useMemo(
    () => ({
      channels: liveChannelBadges.channels,
      dms: liveChannelBadges.dms,
      activity: activityBadgeModel.count,
      // A completed cache remains visible on every tab. The live missed-call
      // query is only enabled when the Calls tab is opened, so the badge does
      // not start a heavy background materialization during app launch.
      calls: hasLiveCallsBadgeSource ? workspaceMissedCalls.length : EMPTY_BADGES.calls,
    }),
    [
      activityBadgeModel.count,
      hasLiveCallsBadgeSource,
      liveChannelBadges.channels,
      liveChannelBadges.dms,
      workspaceMissedCalls,
    ],
  );

  return badges;
}
