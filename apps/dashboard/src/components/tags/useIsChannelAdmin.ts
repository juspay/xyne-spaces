import { useMemo } from 'react';
import { ChannelRole } from '@xyne/shared';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { queries } from '../../zero/queries';
import { useAuthContext } from '../../providers/AuthProvider';

/**
 * Whether the current user is an ADMIN of this channel.
 *
 * Gates the message tag picker: classification is shared, team-visible metadata, so it is
 * the channel's admins who curate it rather than each message's author. The server
 * enforces the same rule in MessagesACL.canUpdate — this only keeps the affordance from
 * appearing for someone who would just get an error.
 *
 * The participants query is keyed by channelId, so every bubble in a channel shares one
 * subscription rather than opening its own.
 */
export const useIsChannelAdmin = (channelId: string | undefined): boolean => {
  const { user } = useAuthContext();
  const [participants] = useCachedQuery(
    queries.channelParticipants({ channelId: channelId ?? '' }),
    {
      enabled: !!channelId,
    },
  );

  return useMemo(
    () =>
      !!user?.id &&
      (participants ?? []).some(p => p.userId === user.id && p.role === ChannelRole.ADMIN),
    [participants, user?.id],
  );
};
