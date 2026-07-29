import { useMemo } from 'react';
import { ChannelScopeType } from '../zero/schema.js';
import { useAllVisibleChannels } from './useChannels.js';

const DM_RANK_CAP = 10;

export function useDmAffinityRank(currentUserId: string | undefined): string[] {
  const visibleChannels = useAllVisibleChannels();
  return useMemo(() => {
    if (!currentUserId) return [];
    const sortedDms = visibleChannels
      .filter(
        ch => ch.scopeType === ChannelScopeType.DM || ch.scopeType === ChannelScopeType.GROUP_DM,
      )
      .sort(
        (a, b) => (b.channelStats?.lastActivityAt || 0) - (a.channelStats?.lastActivityAt || 0),
      );

    const ids: string[] = [];
    for (const ch of sortedDms) {
      if (ids.length >= DM_RANK_CAP) break;
      for (const pid of ch.name.split(',')) {
        if (ids.length >= DM_RANK_CAP) break;
        if (pid !== currentUserId && !ids.includes(pid)) ids.push(pid);
      }
    }
    return ids;
  }, [visibleChannels, currentUserId]);
}
