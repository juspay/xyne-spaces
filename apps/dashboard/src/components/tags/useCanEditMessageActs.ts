import { useAuthContext } from '../../providers/AuthProvider';
import { useChannelMemberIds } from '../../hooks/useChannelMemberIds';

/**
 * Whether the current user may hand-edit a message's acts: its sender, or any member of
 * its channel.
 *
 * Deliberately open — acts are shared metadata like reactions, and a wrong tag costs a
 * click to fix. Every change is logged server-side so the policy can be tightened later
 * against real usage. Mirrors MessagesACL.canUpdate, which enforces it for real; this only
 * keeps the picker from appearing for someone who would just get an error.
 */
export const useCanEditMessageActs = (
  senderId: string | undefined,
  channelId: string | undefined,
): boolean => {
  const { user } = useAuthContext();
  const { memberIds, loaded } = useChannelMemberIds(channelId);

  if (!user?.id) return false;
  if (senderId === user.id) return true;
  // Until participants load, treat membership as unproven rather than assuming it — the
  // picker appearing and then vanishing is worse than appearing a beat late.
  return loaded && memberIds.has(user.id);
};
