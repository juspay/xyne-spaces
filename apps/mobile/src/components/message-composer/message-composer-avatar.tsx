import { memo, type ReactElement } from 'react';
import { Pressable, View } from 'react-native';

import Avatar from '@/src/components/ui/avatar';
import { useMessageComposer } from './message-composer-context';
import { DebugBoundary } from './utils/debug-boundary';
import { useOpenUserDm } from '../conversation-composer/utils/useOpenUserDm';

const AVATAR_SIZE = 24;
const AVATAR_STYLE = {
  width: AVATAR_SIZE,
  height: AVATAR_SIZE,
};

const AvatarSlot = memo((): ReactElement | null => {
  const { item, kind, isContinuation } = useMessageComposer();
  const senderId = item.senderId ?? '';
  const { openUserDm, busy } = useOpenUserDm();

  const handlePress = (): void => {
    void openUserDm(senderId);
  };

  if (kind !== 'OTHER_USER' && kind !== 'BOT') return null;

  if (isContinuation) {
    return (
      <DebugBoundary>
        <View style={AVATAR_STYLE} />
      </DebugBoundary>
    );
  }

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
AvatarSlot.displayName = 'MessageComposer.Avatar';

export { AvatarSlot as Avatar };
