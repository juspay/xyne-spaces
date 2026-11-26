import { memo, useMemo, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import {
  useChatUserProfileActionsSheet,
  useOpenSenderProfile,
} from '@/src/features/chat/v2/components/chat/chat-user-profile-actions-sheet';
import { getSenderAvatarFallbackUser } from '@/src/features/chat/v2/paint/chatPaintAvatarFallback';
import type { ChatPaintRow } from '@/src/features/chat/v2/paint/chatPaint.types';
import { AVATAR_GEOMETRY, AvatarFace, type AvatarFallbackUser } from '@/src/ui/avatar';
import { initialsOf } from '@/src/ui/avatar/avatar.initials';

import { MESSAGE_AVATAR_SIZE, SELF_FACE_INITIALS_SHARE } from '../constants';

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
  // Memoised so SenderFace's memo holds across the row's renders.
  const fallbackUser = useMemo(() => getSenderAvatarFallbackUser(sender), [sender]);

  const face = (
    <SenderFace
      userId={sender.senderId}
      displayName={sender.displayName}
      isSelf={isSelf}
      fallbackUser={fallbackUser}
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

type SenderFaceProps = {
  userId: string;
  displayName: string;
  isSelf: boolean;
  fallbackUser?: AvatarFallbackUser | undefined;
  /** The message row's 32 by default; the initials scale with it. */
  size?: number | undefined;
};

/**
 * A person's face alone, for anything that draws one without a paint row
 * (find results, parked threads, the answer toast), so you look the same
 * everywhere: your initials on the identity colour, anyone else their avatar.
 */
export const SenderFace = memo(function SenderFace({
  userId,
  displayName,
  isSelf,
  fallbackUser,
  size = MESSAGE_AVATAR_SIZE,
}: SenderFaceProps): ReactElement {
  if (!isSelf) {
    return <AvatarFace userId={userId} size={size} fallbackUser={fallbackUser} />;
  }
  return (
    <View
      className='items-center justify-center bg-spaces-identity-self'
      style={{
        width: size,
        height: size,
        borderRadius: size / AVATAR_GEOMETRY.radiusDivisor,
      }}
    >
      <Text
        className='font-semibold text-spaces-accent-foreground'
        style={{ fontSize: size * SELF_FACE_INITIALS_SHARE }}
      >
        {initialsOf(displayName)}
      </Text>
    </View>
  );
});
