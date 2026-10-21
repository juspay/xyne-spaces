import { memo, type ReactElement } from 'react';
import { Text, View } from 'react-native';
import { AlertCircle, Clock } from 'lucide-react-native';
import { usePendingStatusByMessageId } from '@xyne/shared/messages';

import { useConversationComposer } from './conversation-composer-context';
import { DebugBoundary } from './utils/debug-boundary';
import type { ConversationKind } from './utils/getConversationKind';
import { useChatRenderTokens } from '@/src/features/chat/v2/components/chat/message-row';

const formatTime = (timestamp: number): string => {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
};

const showsTimestamp = (kind: ConversationKind): boolean =>
  kind === 'CURRENT_USER' || kind === 'OTHER_USER' || kind === 'BOT' || kind === 'TICKET';

const Timestamp = memo((): ReactElement | null => {
  const { item, kind, paintRow } = useConversationComposer();
  const { rootMetaUser } = useChatRenderTokens();
  const pendingStatus = usePendingStatusByMessageId(item.initialMessageId ?? '');

  if (!showsTimestamp(kind)) return null;

  const isCurrentUser = kind === 'CURRENT_USER';
  const textClass = isCurrentUser ? '' : 'text-conversation-composer-timestamp-other';
  const clockColor = isCurrentUser ? rootMetaUser : '#999';

  return (
    <DebugBoundary>
      <View className='flex-row items-center self-end gap-1'>
        {pendingStatus === 'connecting' && <Clock size={12} color={clockColor} />}
        {pendingStatus === 'failed' && <AlertCircle size={12} color='#e53935' />}
        <Text
          className={`text-[10px] ${textClass}`}
          style={isCurrentUser ? { color: rootMetaUser } : undefined}
        >
          {paintRow?.timeLabel ?? formatTime(item.createdAt)}
        </Text>
      </View>
    </DebugBoundary>
  );
});
Timestamp.displayName = 'ConversationComposer.Timestamp';

export { Timestamp };
