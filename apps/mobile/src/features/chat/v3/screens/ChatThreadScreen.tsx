import { type ReactElement } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  ThreadHeaderV3,
  getThreadHeaderCollapsedHeight,
} from '@/src/components/chat/thread-header-v3';
import { useReportNotificationPhase } from '@/src/observability/logging/hooks/notification/useReportNotificationPhase';

import { surfaceRemountKey } from '../data/conversationRef';
import { ListError } from '../list/ListError';
import { ListSkeleton } from '../list/ListSkeleton';
import { ChatConversation } from './ChatConversation';
import { useReleaseChatOpen } from './useReleaseChatOpen';
import { useThreadSurfaceGate } from './useThreadSurfaceGate';

const ROOT = 'flex-1 bg-chat-screen' as const;

export default function ChatThreadScreen(): ReactElement {
  const insets = useSafeAreaInsets();
  useReportNotificationPhase('chat_visible');
  const { parsed, location, channelId, threadId, isTranscript, isResolverHost } =
    useThreadSurfaceGate();
  useReleaseChatOpen(channelId);
  const ticketRedirect = location?.ok === true && location.value.surface.kind === 'ticket-thread';

  if (ticketRedirect && !isResolverHost) {
    return (
      <View className={ROOT}>
        <ThreadHeaderV3 channelId={channelId} threadId={threadId} />
        <View pointerEvents='none' style={{ height: getThreadHeaderCollapsedHeight(insets.top) }} />
        <ListSkeleton count={5} />
      </View>
    );
  }

  if (!parsed.ok) {
    return (
      <View className={ROOT}>
        <ThreadHeaderV3 channelId={channelId} threadId={threadId} />
        <View pointerEvents='none' style={{ height: getThreadHeaderCollapsedHeight(insets.top) }} />
        <ListError failure={parsed.error} />
      </View>
    );
  }

  return (
    <View key={surfaceRemountKey(parsed.value)} className={ROOT}>
      <ThreadHeaderV3
        channelId={parsed.value.surface.channelId}
        threadId={
          parsed.value.surface.kind === 'channel' ? threadId : parsed.value.surface.threadId
        }
      />
      <View pointerEvents='none' style={{ height: getThreadHeaderCollapsedHeight(insets.top) }} />
      <ChatConversation intent={parsed.value} location={location} isTranscript={isTranscript} />
    </View>
  );
}
