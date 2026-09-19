import { useMemo } from 'react';
import { ChannelRole, WorkspaceRole, OrgRole } from '@xyne/shared';
import { useCachedQuery } from './useCachedQuery';
import { queries } from '../zero/queries';
import { useChannel } from './useChannels';
import { useAuth } from './useAuth';

/**
 * Whether the current user may link boards to a channel.
 *
 * Mirrors the `channel.linkBoards` mutator's check: workspace/org admins and
 * owners, the channel's creator, or a channel admin. The mutator is the real
 * gate — this only decides whether to render the control, so the two must agree
 * or users get a button that always errors.
 */
export const useCanLinkChannelBoards = (channelId: string | undefined): boolean => {
  const { user } = useAuth();
  const channel = useChannel(channelId ?? '');

  const isPrivileged =
    user?.role === WorkspaceRole.ADMIN ||
    user?.role === WorkspaceRole.OWNER ||
    user?.orgRole === OrgRole.ADMIN ||
    user?.orgRole === OrgRole.OWNER;

  const isChannelCreator = !!user?.id && channel?.createdBy === user.id;

  // Only asked when the cheaper checks miss. Returns the current user's
  // ADMIN participations across all channels, so it is a single small query.
  const [adminParticipations] = useCachedQuery(queries.myChannelParticipations({}), {
    enabled: !!channelId && !isPrivileged && !isChannelCreator,
  });

  return useMemo(() => {
    if (!channelId || !channel) return false;
    if (isPrivileged || isChannelCreator) return true;
    return (adminParticipations ?? []).some(
      participation =>
        participation.channelId === channelId && participation.role === ChannelRole.ADMIN,
    );
  }, [channelId, channel, isPrivileged, isChannelCreator, adminParticipations]);
};
