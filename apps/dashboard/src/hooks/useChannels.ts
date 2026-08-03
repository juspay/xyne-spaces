import { useMemo } from 'react';
import { ChannelScopeType } from '@xyne/shared';
import { useAllVisibleChannels } from '@xyne/shared/hooks';
import type { SearchChannelCandidate } from '../components/ui/SearchChannel/SearchChannel';

export {
  searchChannels,
  searchChannelsWithScores,
  useAllChannels,
  useAllVisibleChannels,
  useVisibleProjects,
  useVisibleProjectsWithoutDms,
  useChannel,
  useChannelByName,
  useChannelSearch,
  useBrowsableChannels,
  useMigratedChannels,
  useEmailChannels,
  useChannelsByProjectId,
  useUserChannelStatuses,
  useGetChannelUserStatus,
  useChannelParticipation,
  useGetChannelConversations,
  getChannelConversationsSnapshot,
  useGetLatestConversation,
  useVisibleChannel,
} from '@xyne/shared/hooks';

/** Visible non-DM channels shaped for <SearchChannel mode='channel'>. */
export const useSearchChannelCandidates = (): SearchChannelCandidate[] => {
  const allVisibleChannels = useAllVisibleChannels();
  return useMemo(
    () =>
      allVisibleChannels
        .filter(
          channel =>
            channel.scopeType !== ChannelScopeType.DM &&
            channel.scopeType !== ChannelScopeType.GROUP_DM,
        )
        .map(channel => ({
          id: channel.id,
          name: channel.name || channel.id,
          scopeType: channel.scopeType,
        })),
    [allVisibleChannels],
  );
};
