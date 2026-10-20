import { useCallback, type ReactElement } from 'react';
import { Text, Pressable, View } from 'react-native';
import { KeyboardGestureArea } from 'react-native-keyboard-controller';

import { ChatList } from '@/src/features/chat/v2/components/chat/chat-list';
import { ChatComposerDock } from '@/src/features/chat/v2/components/chat/chat-composer-dock';
import { ChatUserProfileActionsSheetProvider } from '@/src/features/chat/v2/components/chat/chat-user-profile-actions-sheet';
import { JoinChannelCard } from '@/src/components/chat/join-channel-card';
import {
  CHAT_KEYBOARD_GESTURE_INTERPOLATOR,
  CHAT_KEYBOARD_GESTURE_OFFSET,
} from '@/src/features/chat/v2/chatKeyboardConfig';
import {
  ChatChannelMessageActionsController,
  ScrollToBottomButtonController,
} from '@/src/features/chat/v2/screens/chat-channel-controllers';
import { useChatChannelController } from '@/src/features/chat/v2/screens/useChatChannelController';

import { composerPlaceholder, roomKindOf } from '../model/room-title';
import { clearHoldSource } from '../model/hold-source-store';
import { getRoomTypingBarMinimumHeight } from '../model/typing-bar';
import { CONVERSATION_RENDERERS } from '../renderers';
import { HoldMenu } from './hold-menu';
import { ConversationPaletteProvider } from './conversation-palette';
import { RoomHeader } from './room-header';
import { RoomTypingBar } from './room-typing-bar';

const FLEX_STYLE = { flex: 1 } as const;

/**
 * The redesigned channel screen. The controller is the classic screen's, so
 * loading, unread handling, sending, actions and keyboard behaviour are shared;
 * this file only draws the header and hands the list its row renderers.
 */
export const ConversationChannelScreen = (): ReactElement => {
  const {
    channelId,
    conversationId,
    messageId,
    createdAt,
    postPaintReady,
    richHydrationReady,
    handleBackNavigation,
    isResolvingLinkUnavailable,
    router,
    chatListRef,
    chatListCurrentUser,
    channelType,
    isNotificationOpen,
    isLinkResolving,
    openStartedAtMs,
    telemetryNotificationOpenKind,
    chatOpenEntryPoint,
    isUnreadOpen,
    frozenUnreadBoundaryLastViewedAt,
    frozenUnreadBoundaryLastViewedConversationId,
    frozenUnreadCount,
    composerGeometry,
    freeze,
    keyboardGeometry,
    handleMessagePress,
    handleMessageLongPress,
    handleScrolledUpChange,
    handleChatListFirstLayout,
    handleChatListInitialLoadComplete,
    handleChatListInitialLoadStateChange,
    handleOpenPlaceholderChange,
    isComposerDisabled,
    handleComposerShellReady,
    screenOpenIdentityKey,
    scrollToBottomButtonRef,
    handleScrollToBottomPress,
    shouldShowJoinChannel,
    activeChannel,
    includeBottomSafeArea,
    handleSend,
    editingTarget,
    handleCancelEdit,
    isDM,
    displayName,
    messageActionsControllerRef,
    currentUser,
    handleEditInChat,
    handleBeforeMarkUnread,
    handleMarkUnreadFailure,
    handleActionsSheetOpenChange,
    handleActionsSheetDismiss,
  } = useChatChannelController(getRoomTypingBarMinimumHeight);

  // The emoji and forward views close without the hold menu mounted, so the
  // held row is released here, once the sheet is finally gone.
  const handleActionsDismiss = useCallback((): void => {
    clearHoldSource();
    handleActionsSheetDismiss();
  }, [handleActionsSheetDismiss]);

  return (
    <View className='flex-1 bg-spaces-background'>
      <RoomHeader
        channelId={channelId ?? ''}
        postPaintReady={postPaintReady}
        onBack={handleBackNavigation}
      />

      <ChatUserProfileActionsSheetProvider>
        <ConversationPaletteProvider>
          <KeyboardGestureArea
            interpolator={CHAT_KEYBOARD_GESTURE_INTERPOLATOR}
            offset={CHAT_KEYBOARD_GESTURE_OFFSET}
            style={FLEX_STYLE}
          >
            {isResolvingLinkUnavailable ? (
              <View className='flex-1 items-center justify-center gap-3 px-6'>
                <Text className='text-center text-spaces-foreground'>
                  This message is unavailable.
                </Text>
                <Pressable
                  accessibilityRole='button'
                  onPress={() => router.setParams({ resolving: '1' })}
                >
                  <Text className='text-spaces-accent'>Try again</Text>
                </Pressable>
              </View>
            ) : (
              <ChatList
                // Reset message state for a channel switch or a late-resolved
                // notification cursor. The shared hook reads its initial window
                // once, so the cursor must be present when this list mounts.
                key={`${channelId}:${createdAt ?? ''}`}
                ref={chatListRef}
                channelId={channelId ?? ''}
                conversationId={conversationId}
                messageId={messageId}
                createdAt={createdAt}
                currentUser={chatListCurrentUser}
                channelType={channelType}
                liveHydrationEnabled={postPaintReady}
                richHydrationEnabled={richHydrationReady}
                isNotificationOpen={isNotificationOpen}
                isLinkResolving={isLinkResolving}
                openStartedAtMs={openStartedAtMs}
                notificationOpenKind={telemetryNotificationOpenKind}
                entryPoint={chatOpenEntryPoint}
                isUnreadOpen={isUnreadOpen}
                unreadBoundaryLastViewedAt={frozenUnreadBoundaryLastViewedAt}
                unreadBoundaryLastViewedConversationId={
                  frozenUnreadBoundaryLastViewedConversationId
                }
                unreadCount={frozenUnreadCount}
                composerGeometry={composerGeometry}
                freeze={freeze}
                keyboardOffset={keyboardGeometry.listOffset}
                onMessagePress={handleMessagePress}
                onMessageLongPress={handleMessageLongPress}
                onScrolledUpChange={handleScrolledUpChange}
                onFirstLayout={handleChatListFirstLayout}
                onInitialLoadComplete={handleChatListInitialLoadComplete}
                onInitialLoadStateChange={handleChatListInitialLoadStateChange}
                onOpenPlaceholderChange={handleOpenPlaceholderChange}
                renderers={CONVERSATION_RENDERERS}
              />
            )}
          </KeyboardGestureArea>
        </ConversationPaletteProvider>
      </ChatUserProfileActionsSheetProvider>

      <ChatComposerDock
        composerHeight={composerGeometry.totalHeight}
        disabled={isComposerDisabled}
        onComposerHeight={composerGeometry.onComposerHeight}
        keyboardGeometry={keyboardGeometry}
        onComposerLayout={composerGeometry.onComposerLayout}
        onShellReady={handleComposerShellReady}
        shellReadyKey={screenOpenIdentityKey}
        scrollToBottomSlot={
          <ScrollToBottomButtonController
            key={`scroll-to-bottom:${screenOpenIdentityKey}`}
            ref={scrollToBottomButtonRef}
            composerHeight={composerGeometry.totalHeight}
            enabled={postPaintReady}
            onPress={handleScrollToBottomPress}
          />
        }
      >
        {shouldShowJoinChannel ? (
          <JoinChannelCard channelId={channelId ?? ''} channelTitle={activeChannel?.name} />
        ) : (
          <RoomTypingBar
            // Remount the composer on a channel switch so no draft, attachment,
            // or in-flight compose state from a previous channel (e.g. a DM) can
            // be sent into the newly opened channel. Mirrors the ChatList key above.
            key={channelId}
            conversationId={channelId ?? ''}
            disabled={isComposerDisabled}
            includeBottomSafeArea={includeBottomSafeArea}
            onSend={handleSend}
            editingMessage={editingTarget}
            onCancelEdit={handleCancelEdit}
            placeholder={composerPlaceholder(displayName, isDM ? 'dm' : roomKindOf(channelType))}
          />
        )}
      </ChatComposerDock>

      <ChatChannelMessageActionsController
        key={screenOpenIdentityKey}
        ref={messageActionsControllerRef}
        currentUserId={currentUser?.id}
        isChannelArchived={Boolean(activeChannel?.isArchived)}
        channelName={displayName}
        channelScopeType={channelType}
        disabled={shouldShowJoinChannel}
        onEditInChat={handleEditInChat}
        onBeforeMarkUnread={handleBeforeMarkUnread}
        onMarkUnreadFailure={handleMarkUnreadFailure}
        onActionsOpenChange={handleActionsSheetOpenChange}
        onActionsDismiss={handleActionsDismiss}
        actionsView={HoldMenu}
      />
    </View>
  );
};
