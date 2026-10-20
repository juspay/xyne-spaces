import type { ReactElement } from 'react';

import { ChatThread } from '@/src/features/chat/v2/components/chat/chat-thread';
import { useChatThreadSurfaceGate } from './useChatThreadSurfaceGate';

const ChatThreadScreen = (): ReactElement => {
  const {
    resolvedChannelId,
    resolvedThreadId,
    isTranscript,
    isSurfacePending,
    messageId,
    from,
    parsedOpenStartedAtMs,
    chatOpenAttemptId,
    telemetryNotificationOpenKind,
  } = useChatThreadSurfaceGate();

  return (
    <ChatThread
      channelId={resolvedChannelId}
      threadId={resolvedThreadId}
      composerInsetMode='screen'
      isTranscript={isTranscript === 'true'}
      isSurfacePending={isSurfacePending}
      {...(messageId ? { messageId } : {})}
      {...(from ? { from } : {})}
      openStartedAtMs={Number.isFinite(parsedOpenStartedAtMs) ? parsedOpenStartedAtMs : null}
      chatOpenAttemptId={chatOpenAttemptId}
      {...(telemetryNotificationOpenKind
        ? { notificationOpenKind: telemetryNotificationOpenKind }
        : {})}
    />
  );
};

export default ChatThreadScreen;
