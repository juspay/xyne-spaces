import { ChannelScopeType } from '@xyne/shared';

import type { DmChannel } from '@/src/hooks/useDmsPaginatedMessagesV2';
import type { StarredDmEntry } from '@/src/hooks/useStarredDms';
import type { DmListItemData } from '@/src/types/dm-list-item';

export type DmFilterTab = 'all' | 'unread' | 'groups' | 'starred';

export const filterDmListItems = (
  items: DmListItemData[],
  filterTab: DmFilterTab,
): DmListItemData[] => {
  switch (filterTab) {
    case 'unread':
      return items.filter(item => (item.unreadCount ?? 0) > 0);
    case 'groups':
      return items.filter(item => item.scopeType === ChannelScopeType.GROUP_DM);
    case 'starred':
      return items.filter(item => item.isStarred === true);
    case 'all':
    default:
      return items;
  }
};

export const mergeStarredDmChannels = (
  channels: readonly DmChannel[],
  starredDms: readonly StarredDmEntry[],
): DmChannel[] => {
  const channelsById = new Map(channels.map(channel => [channel.id, channel] as const));
  for (const { channel } of starredDms) {
    if (!channelsById.has(channel.id)) {
      channelsById.set(channel.id, { ...channel, conversations: [] });
    }
  }
  return [...channelsById.values()];
};
