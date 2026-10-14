import { memo, type ReactElement } from 'react';
import { Text } from 'react-native';

import { useConversationComposer } from './conversation-composer-context';
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
  const { item, kind, paintRow } = useConversationComposer();

  if (kind !== 'CURRENT_USER' && kind !== 'OTHER_USER' && kind !== 'BOT' && kind !== 'TICKET') {
    return null;
  }

  const textClass =
    kind === 'CURRENT_USER'
      ? 'text-conversation-composer-timestamp-user'
      : 'text-conversation-composer-timestamp-other';

  return (
    <DebugBoundary>
      <Text className={`text-[10px] ${textClass} self-end`}>
        {paintRow?.timeLabel ?? formatTime(item.createdAt)}
      </Text>
    </DebugBoundary>
  );
});
Timestamp.displayName = 'ConversationComposer.Timestamp';

export { Timestamp };
