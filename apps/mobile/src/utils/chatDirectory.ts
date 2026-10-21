import { ChannelScopeType, ChannelType, type ChannelUserStatus } from '@xyne/shared';
import type { VisibleChannel } from '@xyne/shared/hooks';

/** Match dashboard `ChatDirectory.utils`: DM + Group DM classification. */
export const isDMChannel = (scopeType: ChannelScopeType): boolean =>
  scopeType === ChannelScopeType.DM || scopeType === ChannelScopeType.GROUP_DM;

export type GroupedChannels = {
  starred: VisibleChannel[];
  channels: VisibleChannel[];
  directMessages: VisibleChannel[];
};

/**
 * Match dashboard channel grouping behavior.
 * - Excludes email channels
 * - Excludes closed DMs
 * - Prioritizes starred in dedicated section
 */
export const groupChannelsByScope = (
  channelData: VisibleChannel[],
  allChannelsUserStatus: ChannelUserStatus[],
): GroupedChannels => {
  const starred: VisibleChannel[] = [];
  const channels: VisibleChannel[] = [];
  const directMessages: VisibleChannel[] = [];
  const statusById = new Map(allChannelsUserStatus.map(s => [s.channelId, s]));

  for (const channel of channelData) {
    if (channel.type === ChannelType.EMAIL) {
      continue;
    }

    const currentUserParticipation = statusById.get(channel.id);

    if (currentUserParticipation?.isClosed && isDMChannel(channel.scopeType)) {
      continue;
    }

    if (currentUserParticipation?.isStarred) {
      starred.push(channel);
      continue;
    }

    if (channel.scopeType === ChannelScopeType.DEFAULT) {
      channels.push(channel);
    } else if (isDMChannel(channel.scopeType)) {
      directMessages.push(channel);
    }
  }

  return { starred, channels, directMessages };
};

/** Match dashboard `MobileChatDirectory` section sort: `lastActivityAt` desc. */
export const sortByActivity = (list: VisibleChannel[]): VisibleChannel[] =>
  [...list].sort(
    (a, b) =>
      new Date(b.channelStats?.lastActivityAt ?? 0).getTime() -
      new Date(a.channelStats?.lastActivityAt ?? 0).getTime(),
  );
