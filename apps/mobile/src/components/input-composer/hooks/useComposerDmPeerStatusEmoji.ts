import { ChannelScopeType } from '@xyne/shared';
import { useSelf, useUser } from '@/src/hooks/useUsers';
import { useChannelById } from '@/src/hooks/useChannels';
import { getOtherParticipantIds } from '@/src/utils/channel-utils';
import { getActiveUserStatusEmoji } from '@/src/utils/statusUtils';

import { useChatInputConversation } from '../input-composer-context';

/** Active status emoji for the DM peer in the current composer channel, if any. */
export const useComposerDmPeerStatusEmoji = (): string | undefined => {
  const { conversationId, isEditing } = useChatInputConversation();
  const currentUser = useSelf();
  const channel = useChannelById(conversationId);

  const currentUserId = currentUser?.id ?? '';
  const isDmChannel = !isEditing && channel?.scopeType === ChannelScopeType.DM;
  const otherUserId = isDmChannel ? (getOtherParticipantIds(channel, currentUserId)[0] ?? '') : '';
  const otherUser = useUser(otherUserId);

  if (!isDmChannel || !otherUserId) {
    return undefined;
  }

  return getActiveUserStatusEmoji(otherUser);
};
