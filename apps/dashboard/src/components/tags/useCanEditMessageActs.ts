import { useMemo } from 'react';
import { ChannelRole } from '@xyne/shared';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { queries } from '../../zero/queries';
import { useAuthContext } from '../../providers/AuthProvider';

/**
 * Whether the current user may hand-edit a message's acts: its sender, or a channel ADMIN.
 *
 * Mirrors MessagesACL.canUpdate, which enforces it server-side — this only keeps the
 * picker from appearing for someone who would just get an error. Kept as one hook so the
 * rule has a single client-side home rather than being reassembled at each call site.
 *
 * The participants query is keyed by channelId, so bubbles in a channel share one
 * subscription; authors skip it entirely.
 */
export const useCanEditMessageActs = (
  senderId: string | undefined,
  channelId: string | undefined,
): boolean => {
  const { user } = useAuthContext();
  const isAuthor = !!user?.id && senderId === user.id;

  const [participants] = useCachedQuery(
    queries.channelParticipants({ channelId: channelId ?? '' }),
    { enabled: !!channelId && !isAuthor },
  );

  return useMemo(
    () =>
      isAuthor ||
      (!!user?.id &&
        (participants ?? []).some(p => p.userId === user.id && p.role === ChannelRole.ADMIN)),
    [isAuthor, participants, user?.id],
  );
};
