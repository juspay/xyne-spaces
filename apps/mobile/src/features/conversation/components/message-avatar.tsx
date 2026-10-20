import { memo, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import {
  useChatUserProfileActionsSheet,
  useOpenSenderProfile,
} from '@/src/features/chat/v2/components/chat/chat-user-profile-actions-sheet';
import { getSenderAvatarFallbackUser } from '@/src/features/chat/v2/paint/chatPaintAvatarFallback';
import type { ChatPaintRow } from '@/src/features/chat/v2/paint/chatPaint.types';
import { AVATAR_GEOMETRY, AvatarFace } from '@/src/ui/avatar';

import { MESSAGE_AVATAR_SIZE } from '../constants';
import { initialsOf } from '../model/initials';

type MessageAvatarProps = {
  paintRow: ChatPaintRow;
};

/** The sender's squircle. The current user gets initials on the identity colour. */
export const MessageAvatar = memo(function MessageAvatar({
  paintRow,
}: MessageAvatarProps): ReactElement {
  const profileActions = useChatUserProfileActionsSheet();
  const sender = paintRow.senderPaintModel;
  const isSelf = sender.isCurrentUser || paintRow.rowKind === 'CURRENT_USER';

  const handlePress = useOpenSenderProfile({
    userId: sender.senderId,
    displayName: sender.displayName,
  });

  const face = isSelf ? (
    <View
      className='items-center justify-center bg-spaces-identity-self'
      style={{
        width: MESSAGE_AVATAR_SIZE,
        height: MESSAGE_AVATAR_SIZE,
        borderRadius: MESSAGE_AVATAR_SIZE / AVATAR_GEOMETRY.radiusDivisor,
      }}
    >
      <Text className='text-[12px] font-semibold text-spaces-accent-foreground'>
        {initialsOf(sender.displayName)}
      </Text>
    </View>
  ) : (
    <AvatarFace
      userId={sender.senderId}
      size={MESSAGE_AVATAR_SIZE}
      fallbackUser={getSenderAvatarFallbackUser(sender)}
    />
  );

  if (!profileActions || !sender.senderId) return face;

  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={`Open ${sender.displayName} profile actions`}
      hitSlop={6}
      onPress={handlePress}
    >
      {face}
    </Pressable>
  );
});
