import { memo, type ReactElement } from 'react';
import { Text } from 'react-native';

import { useMessageComposer } from './message-composer-context';
import { DebugBoundary } from './utils/debug-boundary';

const formatTime = (timestamp: number): string => {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
};

const Timestamp = memo((): ReactElement | null => {
  const { item, kind } = useMessageComposer();

  if (kind === 'SYSTEM' || kind === 'DELETED') return null;

  return (
    <DebugBoundary>
      <Text className='text-[10px] text-secondary-foreground self-end'>
        {formatTime(item.createdAt)}
      </Text>
    </DebugBoundary>
  );
});
Timestamp.displayName = 'MessageComposer.Timestamp';

export { Timestamp };
