import { memo, type ReactElement } from 'react';
import { View } from 'react-native';

import { useUserPresence } from '@/src/hooks/usePresence';
import { cn } from '@/src/utils/cn';

type PresenceDotProps = {
  userId: string;
  className?: string;
};

/**
 * Small online/offline indicator for avatars.
 * Subscribes only to the given user's presence via useUserPresence.
 */
export const PresenceDot = memo(function PresenceDot({
  userId,
  className,
}: PresenceDotProps): ReactElement | null {
  const { isOnline } = useUserPresence(userId);

  if (!userId) {
    return null;
  }

  return (
    <View
      pointerEvents='none'
      className={cn(
        'absolute -bottom-px -right-px size-2 rounded-full',
        isOnline ? 'bg-green-500' : 'bg-[#9CA3AF]',
        className,
      )}
    />
  );
});
