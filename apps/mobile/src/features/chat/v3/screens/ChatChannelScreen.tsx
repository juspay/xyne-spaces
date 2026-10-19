import { type ReactElement, useMemo } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChatHeaderV3, getChatHeaderCollapsedHeight } from '@/src/components/chat/chat-header-v3';
import { useReportNotificationPhase } from '@/src/observability/logging/hooks/notification/useReportNotificationPhase';

import { firstParam } from '../intent/openIntentSchema';
import { surfaceRemountKey } from '../data/conversationRef';
import { ListError } from '../list/ListError';
import { ChatConversation } from './ChatConversation';
import { recordFromSearchParams } from './searchParams';
import { useReadCursor } from '../read/useReadCursor';
import { useRememberLastOpenChannel } from './useRememberLastOpenChannel';
import { useOpenIntent } from './useOpenIntent';
import { useReleaseChatOpen } from './useReleaseChatOpen';
import { useResolveLocation } from './useResolveLocation';

const ROOT = 'flex-1 bg-chat-screen' as const;

export default function ChatChannelScreen(): ReactElement {
  useReportNotificationPhase('chat_visible');
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  const raw = useMemo(() => recordFromSearchParams(params), [params]);
  const parsed = useOpenIntent(raw);
  const location = useResolveLocation(parsed.ok ? parsed.value : null);
  const channelId =
    parsed.ok && parsed.value.surface.kind === 'channel'
      ? parsed.value.surface.channelId
      : firstParam(params['channelId']);
  useRememberLastOpenChannel(channelId);
  useReleaseChatOpen(channelId);
  const markViewed = useReadCursor(channelId);

  if (!parsed.ok) {
    return (
      <View className={ROOT}>
        <ChatHeaderV3 channelId={channelId} />
        <View pointerEvents='none' style={{ height: getChatHeaderCollapsedHeight(insets.top) }} />
        <ListError failure={parsed.error} />
      </View>
    );
  }

  return (
    <View key={surfaceRemountKey(parsed.value)} className={ROOT}>
      <ChatHeaderV3 channelId={parsed.value.surface.channelId} />
      <View pointerEvents='none' style={{ height: getChatHeaderCollapsedHeight(insets.top) }} />
      <ChatConversation
        intent={parsed.value}
        location={location}
        onBeforeMarkUnread={markViewed.onBeforeMarkUnread}
        onMarkUnreadFailure={markViewed.onMarkUnreadFailure}
        onVisible={markViewed.noteVisible}
      />
    </View>
  );
}
