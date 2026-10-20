import { useEffect, type ReactElement } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChatThread } from '@/src/features/chat/v2/components/chat/chat-thread';
import { useChatThreadSurfaceGate } from '@/src/features/chat/v2/screens/useChatThreadSurfaceGate';

import { THREAD_HEADER_HEIGHT } from '../constants';
import { clearHoldSource } from '../model/hold-source-store';
import { getRoomTypingBarMinimumHeight } from '../model/typing-bar';
import { ThreadTypingBar } from './room-typing-bar';
import { CONVERSATION_RENDERERS } from '../renderers';
import { HoldMenu } from './hold-menu';
import { ConversationPaletteProvider } from './conversation-palette';
import { ThreadHeader } from './thread-header';

/**
 * The redesigned thread screen: the classic route gate and `ChatThread`, with
 * the card header and flat message rows swapped in.
 */
export const ConversationThreadScreen = (): ReactElement => {
  const insets = useSafeAreaInsets();
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

  // The thread has no dismiss seam, so a hold left by the emoji or forward
  // views is released when the screen goes.
  useEffect(() => (): void => clearHoldSource(), []);

  return (
    <ConversationPaletteProvider>
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
        renderers={CONVERSATION_RENDERERS}
        renderHeader={({ channelId, threadId, onBack }) => (
          <ThreadHeader channelId={channelId} threadId={threadId} onBack={onBack} />
        )}
        headerHeight={THREAD_HEADER_HEIGHT + insets.top}
        surfaceClassName='bg-spaces-background'
        messageActionsView={HoldMenu}
        composerInput={ThreadTypingBar}
        composerMinimumHeight={getRoomTypingBarMinimumHeight}
      />
    </ConversationPaletteProvider>
  );
};
