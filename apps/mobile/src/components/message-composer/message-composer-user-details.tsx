import { memo, type ReactElement } from 'react';
import { Pressable, Text } from 'react-native';

import { useMessageComposer } from './message-composer-context';
import { useUser } from '@/src/hooks/useUsers';
import { useUserColor } from '@/src/components/conversation-composer/utils/getUserColor';
import { DebugBoundary } from './utils/debug-boundary';
import { cn } from '@/src/utils/cn';
import { useOpenUserDm } from '../conversation-composer/utils/useOpenUserDm';

type UserDetailsProps = {
  className?: string;
};

const UserDetails = memo(({ className }: UserDetailsProps): ReactElement | null => {
  const { item, kind, isContinuation } = useMessageComposer();
  const senderId = item.senderId ?? '';
  const sender = useUser(senderId);
  const color = useUserColor(senderId);
  const { openUserDm, busy } = useOpenUserDm();

  if (kind !== 'OTHER_USER' && kind !== 'BOT') return null;
  if (isContinuation) return null;
  if (!sender?.name) return null;

  const handlePress = (): void => {
    void openUserDm(senderId);
  };

  return (
    <DebugBoundary>
      <Pressable
        onPress={handlePress}
        disabled={busy || !senderId}
        hitSlop={4}
        style={({ pressed }) => (pressed ? { opacity: 0.7 } : null)}
      >
        <Text className={cn('text-sm font-semibold', className)} style={{ color }}>
          {sender.name}
        </Text>
      </Pressable>
    </DebugBoundary>
  );
});
UserDetails.displayName = 'MessageComposer.UserDetails';

export { UserDetails };
