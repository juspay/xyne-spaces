import { memo, type ReactElement } from 'react';
import { Pressable } from 'react-native';
import { ChannelScopeType } from '@xyne/shared';

import Avatar from '@/src/components/ui/avatar';
import { useConversationComposer } from './conversation-composer-context';
import { useOpenUserDm } from './utils/useOpenUserDm';
import { DebugBoundary } from './utils/debug-boundary';

const AVATAR_SIZE = 24;

const AvatarSlot = memo((): ReactElement | null => {
  const { summary, kind, channelType, paintRow } = useConversationComposer();
  const senderId = summary?.senderId ?? paintRow?.senderPaintModel.senderId ?? '';
  const { openUserDm, busy } = useOpenUserDm();

  if (channelType === ChannelScopeType.DM) return null;
  if (
    kind !== 'OTHER_USER' &&
    kind !== 'TICKET' &&
    kind !== 'BOT' &&
    paintRow?.rowKind !== 'OTHER_USER' &&
    paintRow?.rowKind !== 'TICKET' &&
    paintRow?.rowKind !== 'BOT'
  ) {
    return null;
  }

  const handlePress = (): void => {
    void openUserDm(senderId);
  };

  return (
    <DebugBoundary>
      <Pressable
        onPress={handlePress}
        disabled={busy || !senderId}
        hitSlop={6}
        style={({ pressed }) => (pressed ? { opacity: 0.7 } : null)}
      >
        <Avatar userIds={senderId ? [senderId] : []} size={AVATAR_SIZE} />
      </Pressable>
    </DebugBoundary>
  );
});
AvatarSlot.displayName = 'ConversationComposer.Avatar';

export { AvatarSlot as Avatar };
