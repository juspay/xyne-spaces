import { memo, type ReactElement } from 'react';
import { Pressable, View, type GestureResponderEvent } from 'react-native';
import { ChannelScopeType } from '@xyne/shared';

import Avatar from '@/src/components/ui/avatar';
import type { AvatarFallbackUser } from '@/src/components/ui/avatar/avatar.types';
import { useChatUserProfileActionsSheet } from '@/src/features/chat/v2/components/chat/chat-user-profile-actions-sheet';
import { getSenderAvatarFallbackUsers } from '@/src/features/chat/v2/paint/chatPaintAvatarFallback';
import { useConversationComposer } from './conversation-composer-context';
import { useOpenUserDm } from './utils/useOpenUserDm';
import { DebugBoundary } from './utils/debug-boundary';

const AVATAR_SIZE = 24;

type AvatarSlotProps = {
  showCurrentUser?: boolean;
};

const AvatarSlot = memo(({ showCurrentUser = false }: AvatarSlotProps): ReactElement | null => {
  const { summary, kind, channelType, paintRow, currentUser } = useConversationComposer();
  const senderId = summary?.senderId ?? paintRow?.senderPaintModel.senderId ?? '';
  const { openUserDm, busy } = useOpenUserDm();
  const profileActions = useChatUserProfileActionsSheet();
  const isCurrentUserMessage = !!senderId && senderId === currentUser?.id;
  const showForDefaultKind =
    kind === 'OTHER_USER' ||
    kind === 'TICKET' ||
    kind === 'BOT' ||
    paintRow?.rowKind === 'OTHER_USER' ||
    paintRow?.rowKind === 'TICKET' ||
    paintRow?.rowKind === 'BOT';
  const shouldShowCurrentUser = showCurrentUser && isCurrentUserMessage;
  const currentUserDisplayName =
    currentUser?.displayName ?? currentUser?.name ?? currentUser?.email ?? 'You';

  if (channelType === ChannelScopeType.DM && !shouldShowCurrentUser) {
    return null;
  }
  if (paintRow && !paintRow.showAvatar && !shouldShowCurrentUser) {
    return <View style={{ width: AVATAR_SIZE }} />;
  }
  if (!showForDefaultKind && !shouldShowCurrentUser) {
    return null;
  }
  const fallbackUsers: readonly AvatarFallbackUser[] =
    paintRow?.senderPaintModel !== undefined
      ? getSenderAvatarFallbackUsers(paintRow.senderPaintModel)
      : showCurrentUser && isCurrentUserMessage && currentUser
        ? [
            {
              id: currentUser.id,
              name: currentUser.name,
              displayName: currentUserDisplayName,
              picture: currentUser.picture ?? null,
            },
          ]
        : [];

  const handlePress = (event: GestureResponderEvent): void => {
    event.stopPropagation();
    if (profileActions) {
      const profileDisplayName =
        paintRow?.senderPaintModel.displayName ??
        (isCurrentUserMessage ? currentUserDisplayName : undefined);
      profileActions.openUserProfileActions({
        userId: senderId,
        displayName: profileDisplayName,
        email: isCurrentUserMessage ? currentUser?.email : undefined,
      });
      return;
    }
    void openUserDm(senderId);
  };

  return (
    <DebugBoundary>
      <Pressable
        onPress={handlePress}
        disabled={!senderId || (!profileActions && busy)}
        hitSlop={6}
        style={({ pressed }) => (pressed ? { opacity: 0.7 } : null)}
      >
        <Avatar
          userIds={senderId ? [senderId] : []}
          fallbackUsers={fallbackUsers}
          size={AVATAR_SIZE}
        />
      </Pressable>
    </DebugBoundary>
  );
});
AvatarSlot.displayName = 'ConversationComposer.Avatar';

export { AvatarSlot as Avatar };
