import { useEffect, type ReactElement } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChatThread } from '@/src/features/chat/v2/components/chat/chat-thread';
import { useChatThreadSurfaceGate } from '@/src/features/chat/v2/screens/useChatThreadSurfaceGate';
import { useJoinableChannel } from '@/src/hooks/useJoinableChannel';

import {
  THREAD_CARD_BOTTOM,
  THREAD_CARD_INSET_X,
  THREAD_CARD_RADIUS,
  THREAD_CARD_TOP_GAP,
  THREAD_HEADER_HEIGHT,
  TRAY_SHADOW,
} from '../constants';
import { floatingCardBottom } from '../model/floating-card';
import { clearHoldSource } from '../model/hold-source-store';
import { getThreadTypingBarMinimumHeight } from '../model/typing-bar';
import { ThreadTypingBar } from './room-typing-bar';
import { CONVERSATION_RENDERERS } from '../renderers';
import { ThreadCardHoldMenu } from './hold-menu';
import { ConversationJumpArrow } from './jump-arrow';
import { ConversationPaletteProvider } from './conversation-palette';
import { ConversationScrim } from './conversation-scrim';
import { ThreadHeader } from './thread-header';

/**
 * The redesigned thread: the classic route gate and `ChatThread`, with the
 * card header and flat message rows swapped in, presented as a card over the
 * room (the chat stack shows this route as a transparent modal). Tapping the
 * scrim around the card collapses it, like the header's collapse button.
 */
export const ConversationThreadScreen = (): ReactElement => {
  const insets = useSafeAreaInsets();
  const router = useRouter();
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
  const { shouldShowJoinChannel } = useJoinableChannel(resolvedChannelId);
  const cardBottom = floatingCardBottom(
    THREAD_CARD_BOTTOM,
    insets.bottom,
    Platform.OS === 'android',
  );

  // The thread has no dismiss seam, so a hold left by the emoji or forward
  // views is released when the screen goes.
  useEffect(() => (): void => clearHoldSource(), []);

  const collapse = (): void => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace({ pathname: '/chat/[channelId]', params: { channelId: resolvedChannelId } });
  };

  return (
    <View style={StyleSheet.absoluteFill}>
      <ConversationScrim label='Collapse thread' onPress={collapse} />
      <View
        className='absolute bg-spaces-background'
        style={[
          TRAY_SHADOW,
          {
            left: THREAD_CARD_INSET_X,
            right: THREAD_CARD_INSET_X,
            top: insets.top + THREAD_CARD_TOP_GAP,
            bottom: cardBottom,
            borderRadius: THREAD_CARD_RADIUS,
          },
        ]}
      >
        {/* A separate clip, because clipping the shadowed view would clip its shadow on iOS. */}
        <View className='flex-1 overflow-hidden' style={{ borderRadius: THREAD_CARD_RADIUS }}>
          <ConversationPaletteProvider
            widthInset={THREAD_CARD_INSET_X * 2}
            canReact={!shouldShowJoinChannel}
          >
            <ChatThread
              channelId={resolvedChannelId}
              threadId={resolvedThreadId}
              composerInsetMode='embedded'
              keyboardBottomOffset={cardBottom}
              isTranscript={isTranscript === 'true'}
              isSurfacePending={isSurfacePending}
              {...(messageId ? { messageId } : {})}
              {...(from ? { from } : {})}
              openStartedAtMs={
                Number.isFinite(parsedOpenStartedAtMs) ? parsedOpenStartedAtMs : null
              }
              chatOpenAttemptId={chatOpenAttemptId}
              {...(telemetryNotificationOpenKind
                ? { notificationOpenKind: telemetryNotificationOpenKind }
                : {})}
              renderers={CONVERSATION_RENDERERS}
              renderHeader={({ channelId, threadId, onBack }) => (
                <ThreadHeader channelId={channelId} threadId={threadId} onBack={onBack} />
              )}
              headerHeight={THREAD_HEADER_HEIGHT}
              surfaceClassName='bg-spaces-background'
              messageActionsView={ThreadCardHoldMenu}
              composerInput={ThreadTypingBar}
              composerMinimumHeight={getThreadTypingBarMinimumHeight}
              composerIntrinsicHeight
              scrollToBottomButton={ConversationJumpArrow}
            />
          </ConversationPaletteProvider>
        </View>
      </View>
    </View>
  );
};
