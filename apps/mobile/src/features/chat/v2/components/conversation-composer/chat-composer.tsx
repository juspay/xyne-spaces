import { memo, useCallback, useState, type ReactElement } from 'react';
import { Pressable, Text, View, type LayoutChangeEvent } from 'react-native';
import { useRouter } from 'expo-router';
import { KeyboardController } from 'react-native-keyboard-controller';

import { ConversationComposer, useConversationComposer } from './conversation-composer';
import type { ConversationItem } from './conversation-composer.types';
import { ChannelScopeType, parseTicketMd, User } from '@xyne/shared';
import { cn } from '@/src/utils/cn';
import { DELETED_ATTACHMENT_PLACEHOLDER } from '@/src/utils/activeAttachments';
import { DebugBoundary } from './utils/debug-boundary';
import type { ChatPaintRow } from '@/src/features/chat/v2/paint/chatPaint.types';
import { LinkPreviewCard } from '@/src/features/chat/v2/components/chat/link-preview-card';
import { useChatRenderTokens } from '@/src/features/chat/v2/components/chat/message-row';
import { hasBlockMarkdown } from './utils/parseInlineRich';
import { hasMarkdownTable } from '@/src/utils/markdownTable';
import { isFlowJsonHtml } from '@/src/utils/flowJsonMarkdown';

const hasAnyAttachment = (item: ConversationItem): boolean =>
  (item.initialMessageAttachments ?? []).length > 0;

type ChatComposerProps = {
  conversation: ConversationItem;
  currentUser: User | undefined;
  channelType?: ChannelScopeType;
  onPress?: (conversation: ConversationItem) => void;
  onLongPress?: (conversation: ConversationItem) => void;
  /** Press handler for the embedded ticket card only; takes precedence over onPress there. */
  onTicketPress?: () => void;
  paintRow?: ChatPaintRow;
  allowMediaHydration?: boolean;
  allowInlineEmojiHydration?: boolean;
  isContentExpanded?: boolean;
  onContentExpanded?: (conversationId: string) => void;
};

const ChatComposerInner = (): ReactElement => {
  const { kind, item, paintRow, parentMessage, isContentExpanded, summary } =
    useConversationComposer();
  const isDeleted = !!summary?.isDeleted;
  const isCurrentUser = kind === 'CURRENT_USER';
  const bubbleBg = isCurrentUser
    ? 'bg-conversation-composer-root-bg-user'
    : 'bg-conversation-composer-root-bg-other';
  const bubbleShadow = isCurrentUser
    ? 'light:shadow-[0px_1px_0.25px_0px_rgba(11,20,26,0.06)] dark:shadow-none'
    : 'light:shadow-[0px_1px_0.5px_0px_rgba(11,20,26,0.06)] dark:shadow-[0px_1px_0.5px_0px_rgba(11,20,26,0.13)]';

  const replyCount = parentMessage ? 0 : (paintRow?.replyCount ?? item.replyCount ?? 0);
  const hasTicket =
    !isDeleted && (!!paintRow?.ticketPreview || !!parseTicketMd(item.ticket_md ?? null));
  const hasAttachments =
    !isDeleted && (hasAnyAttachment(item) || !!paintRow?.allAttachmentsDeleted);
  const showBorderTop = replyCount > 0 && !hasTicket && !hasAttachments;
  const {
    ambientAccentColor,
    currentUserBubbleBg,
    embeddedBgUser,
    embeddedMutedUser,
    embeddedTitleUser,
    inlineContentMaxWidth,
    mutedForeground,
    rootAccentUser,
    rootTextOther,
    rootTextUser,
  } = useChatRenderTokens();
  const deletedAttachmentLabelColor = isCurrentUser ? rootTextUser : rootTextOther;
  const hasExpandedBlockBody =
    isContentExpanded && !!paintRow?.body?.markdown && hasBlockMarkdown(paintRow.body.markdown);
  const hasTableBody = !!paintRow?.body?.markdown && hasMarkdownTable(paintRow.body.markdown);
  const hasFlowJson = isFlowJsonHtml(summary?.content ?? '');
  const fixedBubbleStyle =
    hasTicket || hasAttachments || hasExpandedBlockBody || hasFlowJson || hasTableBody
      ? { width: inlineContentMaxWidth }
      : undefined;
  const currentUserBubbleStyle = isCurrentUser ? { backgroundColor: currentUserBubbleBg } : null;
  const [bubbleWidth, setBubbleWidth] = useState(0);
  const handleBubbleLayout = useCallback((event: LayoutChangeEvent): void => {
    const width = Math.round(event.nativeEvent.layout.width);
    setBubbleWidth(current => (current === width ? current : width));
  }, []);

  return (
    <View className='max-w-[78%]' style={fixedBubbleStyle}>
      <View
        onLayout={handleBubbleLayout}
        className={cn('rounded-xl px-2 py-1.5', bubbleBg, bubbleShadow)}
        style={currentUserBubbleStyle}
      >
        <ConversationComposer.UserDetails className='mb-2' />
        {isDeleted ? (
          <ConversationComposer.Deleted />
        ) : (
          <>
            <ConversationComposer.RepliedToThread />
            <ConversationComposer.Forwarded className='mb-2.5' />
            <ConversationComposer.Content />
            <ConversationComposer.Ticket className='mb-2.5' />
            <LinkPreviewCard
              preview={paintRow?.linkPreview ?? null}
              isCurrentUser={isCurrentUser}
              mutedForeground={mutedForeground}
              accentColor={ambientAccentColor}
              currentUserColors={{
                backgroundColor: embeddedBgUser,
                titleColor: embeddedTitleUser,
                mutedColor: embeddedMutedUser,
                accentColor: rootAccentUser,
              }}
            />
            <ConversationComposer.Attachments />
            {paintRow?.allAttachmentsDeleted ? (
              <Text
                className='mb-2.5 text-[16px] italic leading-5'
                style={{ color: deletedAttachmentLabelColor }}
              >
                {DELETED_ATTACHMENT_PLACEHOLDER}
              </Text>
            ) : null}
          </>
        )}

        <DebugBoundary>
          <View
            className={cn(
              'flex-row items-end gap-1',
              showBorderTop ? 'pt-2 border-t border-border' : '',
            )}
          >
            <ConversationComposer.Replies />
            <View className='flex-1' />
            {isDeleted ? null : (
              <>
                <ConversationComposer.Edited />
                <ConversationComposer.Bookmarked />
                <ConversationComposer.Pinned />
              </>
            )}
            <ConversationComposer.Timestamp />
          </View>
        </DebugBoundary>
      </View>
      {isDeleted ? null : <ConversationComposer.Reactions availableBubbleWidth={bubbleWidth} />}
    </View>
  );
};

type ChatComposerPressableProps = {
  onPress?: (conversation: ConversationItem) => void;
  onLongPress?: (conversation: ConversationItem) => void;
};

const ChatComposerPressable = ({
  onPress,
  onLongPress,
}: ChatComposerPressableProps): ReactElement => {
  const { item, kind, shouldIgnoreBubblePress } = useConversationComposer();
  const router = useRouter();
  const resolvedTicketId = item.ticketId || parseTicketMd(item.ticket_md ?? null)?.id || '';
  // Bot messages can own replies and must use the same thread-opening gesture
  // as user messages. Keep system messages non-pressable because they have
  // their own dedicated actions.
  const isPressableKind =
    kind === 'CURRENT_USER' || kind === 'OTHER_USER' || kind === 'BOT' || kind === 'TICKET';

  const handlePress = (): void => {
    if (shouldIgnoreBubblePress()) return;
    if (onPress) {
      onPress(item);
      return;
    }
    if (KeyboardController.isVisible()) {
      void KeyboardController.dismiss();
      return;
    }
    if (resolvedTicketId) {
      router.push({
        pathname: '/ticket/[ticketId]',
        params: {
          ticketId: resolvedTicketId,
          channelId: item.channelId,
          threadId: item.conversationId,
        },
      });
      return;
    }
    router.push({
      pathname: '/chat/[channelId]/[threadId]',
      params: {
        channelId: item.channelId,
        threadId: item.conversationId,
        from: 'channel_thread',
        openStartedAtMs: String(Date.now()),
      },
    });
  };

  const handleLongPress = onLongPress ? (): void => onLongPress(item) : undefined;

  if (kind === 'SYSTEM') {
    return (
      <View className='py-1 flex-row justify-center'>
        <ConversationComposer.SystemMessage />
      </View>
    );
  }

  const justify = kind === 'CURRENT_USER' ? 'justify-end' : 'justify-start';

  return (
    <Pressable
      className={cn('py-1 flex-row items-end gap-2', justify)}
      onPress={isPressableKind ? handlePress : undefined}
      onLongPress={handleLongPress}
      disabled={!isPressableKind && !onLongPress}
      style={({ pressed }) => (pressed && isPressableKind ? { opacity: 0.7 } : null)}
    >
      <ConversationComposer.Avatar />
      <ChatComposerInner />
    </Pressable>
  );
};

const ChatComposerComponent = ({
  conversation,
  currentUser,
  channelType,
  onPress,
  onLongPress,
  onTicketPress,
  paintRow,
  allowMediaHydration = true,
  allowInlineEmojiHydration = true,
  isContentExpanded = false,
  onContentExpanded,
}: ChatComposerProps): ReactElement => {
  return (
    <ConversationComposer.Root
      item={conversation}
      currentUser={currentUser}
      allowMediaHydration={allowMediaHydration}
      allowInlineEmojiHydration={allowInlineEmojiHydration}
      isContentExpanded={isContentExpanded}
      {...(onContentExpanded ? { onContentExpanded } : {})}
      {...(onTicketPress ? { onTicketPress } : {})}
      {...(onTicketPress && onLongPress
        ? { onTicketLongPress: (): void => onLongPress(conversation) }
        : {})}
      {...(channelType !== undefined ? { channelType } : {})}
      {...(paintRow ? { paintRow } : {})}
    >
      <ChatComposerPressable
        {...(onPress !== undefined ? { onPress } : {})}
        {...(onLongPress !== undefined ? { onLongPress } : {})}
      />
    </ConversationComposer.Root>
  );
};

const ChatComposer = memo(ChatComposerComponent);
ChatComposer.displayName = 'ChatComposer';

export { ChatComposer };
