import { ReactElement } from 'react';
import { Text, Pressable, View } from 'react-native';
import { KeyboardGestureArea } from 'react-native-keyboard-controller';

import { ChatHeaderV3, getChatHeaderCollapsedHeight } from '@/src/components/chat/chat-header-v3';
import { ChatList } from '@/src/features/chat/v2/components/chat/chat-list';
import { ChatComposerDock } from '@/src/features/chat/v2/components/chat/chat-composer-dock';
import { ChatUserProfileActionsSheetProvider } from '@/src/features/chat/v2/components/chat/chat-user-profile-actions-sheet';
import { ConversationInput } from '@/src/components/input-composer';
import { JoinChannelCard } from '@/src/components/chat/join-channel-card';
import {
  CHAT_KEYBOARD_GESTURE_INTERPOLATOR,
  CHAT_KEYBOARD_GESTURE_OFFSET,
} from '@/src/features/chat/v2/chatKeyboardConfig';
import {
  ChatChannelMessageActionsController,
  ScrollToBottomButtonController,
} from './chat-channel-controllers';
import { useChatChannelController } from './useChatChannelController';

const FLEX_STYLE = { flex: 1 } as const;

const ChatChannelScreen = (): ReactElement => {
  const {
    channelId,
    conversationId,
    messageId,
    createdAt,
    postPaintReady,
    richHydrationReady,
    handleBackNavigation,
    insets,
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
  } = useChatChannelController();

  return (
    <View className='flex-1 bg-chat-screen '>
      <ChatHeaderV3
        channelId={channelId ?? ''}
        postPaintReady={postPaintReady}
        onBack={handleBackNavigation}
      />
      <View pointerEvents='none' style={{ height: getChatHeaderCollapsedHeight(insets.top) }} />

      <ChatUserProfileActionsSheetProvider>
        <KeyboardGestureArea
          interpolator={CHAT_KEYBOARD_GESTURE_INTERPOLATOR}
          offset={CHAT_KEYBOARD_GESTURE_OFFSET}
          style={FLEX_STYLE}
        >
          {isResolvingLinkUnavailable ? (
            <View className='flex-1 items-center justify-center gap-3 px-6'>
              <Text className='text-center text-foreground'>This message is unavailable.</Text>
              <Pressable
                accessibilityRole='button'
                onPress={() => router.setParams({ resolving: '1' })}
              >
                <Text className='text-primary'>Try again</Text>
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
              unreadBoundaryLastViewedConversationId={frozenUnreadBoundaryLastViewedConversationId}
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
            />
          )}
        </KeyboardGestureArea>
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
          <ConversationInput
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
            placeholder={isDM ? `Message ${displayName}` : 'Type a message...'}
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
        onActionsDismiss={handleActionsSheetDismiss}
      />
    </View>
  );
};

export default ChatChannelScreen;
