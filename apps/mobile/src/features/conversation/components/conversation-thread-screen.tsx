import { useCallback, useEffect, useMemo, type ReactElement } from 'react';
import { Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { GestureDetector } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChatThread } from '@/src/features/chat/v2/components/chat/chat-thread';
import { useChatThreadSurfaceGate } from '@/src/features/chat/v2/screens/useChatThreadSurfaceGate';
import { useJoinableChannel } from '@/src/hooks/useJoinableChannel';

import {
  THREAD_CARD_BOTTOM,
  THREAD_CARD_INSET_X,
  THREAD_CARD_TOP_GAP,
  THREAD_CARD_START_AT_TOP_MAX_ROWS,
  THREAD_HEADER_HEIGHT,
  THREAD_HEADER_Z_INDEX,
  TRAY_SHADOW,
} from '../constants';
import { useBubbleReturn } from '../hooks/use-bubble-return';
import { useThreadCardMotion } from '../hooks/use-thread-card-motion';
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

  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const { source } = useLocalSearchParams<{ source?: string }>();
  const cardTop = insets.top + THREAD_CARD_TOP_GAP;

  // The thread has no dismiss seam, so a hold left by the emoji or forward
  // views is released when the screen goes.
  useEffect(() => (): void => clearHoldSource(), []);
  useBubbleReturn();

  const collapse = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace({ pathname: '/chat/[channelId]', params: { channelId: resolvedChannelId } });
  }, [resolvedChannelId, router]);

  // A thread opened from outside the app (a notification, a link) is already
  // there, as the route skips its animation for those. One opened in the app
  // (a room, Activity, Search, a bubble) animates over the screen it came from.
  const openedFromOutside = [source, from].some(
    value => value === 'notification' || value === 'deeplink',
  );
  const target = useMemo(
    () => ({
      x: THREAD_CARD_INSET_X,
      y: cardTop,
      width: windowWidth - THREAD_CARD_INSET_X * 2,
      height: windowHeight - cardTop - cardBottom,
    }),
    [cardBottom, cardTop, windowHeight, windowWidth],
  );
  const {
    morphing,
    cardStyle,
    cornerStyle,
    contentStyle,
    scrimStyle,
    dragGesture,
    cardHeight,
    onContentReady,
  } = useThreadCardMotion({
    target,
    instant: openedFromOutside,
    threadId: resolvedThreadId,
    onDragClose: collapse,
  });

  return (
    <View style={StyleSheet.absoluteFill}>
      <Animated.View style={[StyleSheet.absoluteFill, scrimStyle]}>
        <ConversationScrim label='Collapse thread' onPress={collapse} />
      </Animated.View>
      <Animated.View
        className='absolute bg-spaces-background dark:border dark:border-spaces-outline'
        // A morphing card changes size every frame; its height at rest is the target's.
        {...(morphing
          ? {}
          : { onLayout: event => cardHeight.set(event.nativeEvent.layout.height) })}
        style={[
          TRAY_SHADOW,
          morphing
            ? null
            : {
                left: THREAD_CARD_INSET_X,
                right: THREAD_CARD_INSET_X,
                top: cardTop,
                bottom: cardBottom,
              },
          cornerStyle,
          cardStyle,
        ]}
      >
        {/* A separate clip, because clipping the shadowed view would clip its shadow on iOS. */}
        <Animated.View className='flex-1 overflow-hidden' style={cornerStyle}>
          <Animated.View style={contentStyle}>
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
                onListRevealed={onContentReady}
                startShortThreadsAtTop={THREAD_CARD_START_AT_TOP_MAX_ROWS}
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
                  // The header is the card's grip: dragging it down closes the card.
                  <GestureDetector gesture={dragGesture}>
                    {/* The header's own frame, so the drag has an area to start in. */}
                    <View
                      className='absolute left-0 right-0 top-0'
                      style={{ height: THREAD_HEADER_HEIGHT, zIndex: THREAD_HEADER_Z_INDEX }}
                    >
                      <ThreadHeader channelId={channelId} threadId={threadId} onBack={onBack} />
                    </View>
                  </GestureDetector>
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
          </Animated.View>
        </Animated.View>
      </Animated.View>
    </View>
  );
};
