import { useMemo } from 'react';
import { ChannelScopeType, ChannelVisibility } from '@xyne/shared';

import { useChannelById, useGetChannelUserStatus } from '@/src/hooks/useChannels';
import { useQuery } from '@/src/hooks/useQuery';
import { queries } from '@/src/zero/queries';

type ChannelById = ReturnType<typeof useChannelById>;
type ChannelUserStatusById = ReturnType<typeof useGetChannelUserStatus>;
type ChannelMembershipState = 'unknown' | 'member' | 'non-member';

export type JoinableChannelState = {
  channel: ChannelById;
  channelUserStatus: ChannelUserStatusById;
  isMember: boolean;
  shouldShowJoinChannel: boolean;
};

export function useJoinableChannel(channelId: string | null | undefined): JoinableChannelState {
  const resolvedChannelId = channelId ?? '';
  const channel = useChannelById(resolvedChannelId);
  const channelUserStatusFromState = useGetChannelUserStatus(resolvedChannelId);
  const channelUserStatusQuery = useMemo(
    () => queries.getChannelUserStatus({ channelId: resolvedChannelId }),
    [resolvedChannelId],
  );
  const [channelUserStatusFromQuery, channelUserStatusDetails] = useQuery(channelUserStatusQuery, {
    enabled: channelUserStatusFromState === undefined && resolvedChannelId !== '',
  });

  return useMemo(() => {
    const channelUserStatus = channelUserStatusFromState ?? channelUserStatusFromQuery;
    const membershipState: ChannelMembershipState = channelUserStatus
      ? 'member'
      : channelUserStatusDetails.type === 'complete'
        ? 'non-member'
        : 'unknown';
    const isMember = Boolean(channelUserStatus);
    const shouldShowJoinChannel =
      channel?.scopeType === ChannelScopeType.DEFAULT &&
      channel.visibility === ChannelVisibility.PUBLIC &&
      !channel.isArchived &&
      membershipState === 'non-member';

    return {
      channel,
      channelUserStatus,
      isMember,
      shouldShowJoinChannel,
    };
  }, [
    channel,
    channelUserStatusDetails.type,
    channelUserStatusFromQuery,
    channelUserStatusFromState,
  ]);
}
