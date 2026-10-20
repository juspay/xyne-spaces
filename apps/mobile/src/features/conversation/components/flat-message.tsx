import { memo, useCallback, type ReactElement, type Ref } from 'react';
import { Pressable, Text, View, type PressableStateCallbackType } from 'react-native';
import { ChannelScopeType, type User } from '@xyne/shared';

import { PaintPreviewText } from '@/src/features/chat/v2/components/chat/chat-paint-row-lite';
import {
  useChatUserProfileActionsSheet,
  useOpenSenderProfile,
} from '@/src/features/chat/v2/components/chat/chat-user-profile-actions-sheet';
import { PaintTimeLabel } from '@/src/features/chat/v2/components/chat/paint-time-label';
import { ChatRenderProvider } from '@/src/features/chat/v2/components/chat/message-row';
import {
  ConversationComposer,
  useConversationComposer,
  type ConversationItem,
} from '@/src/features/chat/v2/components/conversation-composer';
import type { ChatPaintRow } from '@/src/features/chat/v2/paint/chatPaint.types';
import { DELETED_ATTACHMENT_PLACEHOLDER } from '@/src/utils/activeAttachments';

import {
  CONTINUATION_TOP_OFFSET,
  MESSAGE_EXTRAS_GAP,
  MESSAGE_GAP,
  MESSAGE_HEADER_GAP,
  MESSAGE_PADDING_X,
  MESSAGE_PADDING_Y,
  MESSAGE_AVATAR_SIZE,
  CONTENT_INNER_MARGIN,
  THREAD_HOOK_RADIUS,
  THREAD_HOOK_TOP_GAP,
  THREAD_STRIP_HEIGHT,
} from '../constants';
import { useSenderIsAgent } from '../hooks/use-sender-is-agent';
import { lowerMeridiem } from '../model/message-time';
import { AgentTag } from './agent-tag';
import { useConversationRenderTokens } from './conversation-palette';
import { MessageAttachments } from './message-attachments';
import { MessageAvatar } from './message-avatar';
import { ReactionChips } from './reaction-chips';
import { ThreadStrip } from './thread-strip';

const LONG_PRESS_DELAY_MS = 300;

const ROW_STYLE = {
  paddingHorizontal: MESSAGE_PADDING_X,
  paddingVertical: MESSAGE_PADDING_Y,
  columnGap: MESSAGE_GAP,
} as const;
const ROW_PRESSED_STYLE = { ...ROW_STYLE, opacity: 0.7 } as const;

// A continuation has no top padding of its own and pulls up under the row above.
const CONTINUATION_ROW_STYLE = {
  ...ROW_STYLE,
  paddingTop: 0,
  marginTop: CONTINUATION_TOP_OFFSET,
} as const;
const CONTINUATION_ROW_PRESSED_STYLE = { ...CONTINUATION_ROW_STYLE, opacity: 0.7 } as const;

const getRowStyle = ({ pressed }: PressableStateCallbackType): typeof ROW_STYLE =>
  pressed ? ROW_PRESSED_STYLE : ROW_STYLE;
const getContinuationRowStyle = ({
  pressed,
}: PressableStateCallbackType): typeof CONTINUATION_ROW_STYLE =>
  pressed ? CONTINUATION_ROW_PRESSED_STYLE : CONTINUATION_ROW_STYLE;

export type FlatMessageProps = {
  paintRow: ChatPaintRow;
  conversation: ConversationItem;
  currentUser: User | undefined;
  channelType?: ChannelScopeType | undefined;
  isContentExpanded: boolean;
  onContentExpanded: (conversationId: string) => void;
  /** Draws the shared rich body; otherwise the lite paint text, as the classic rows do before promotion. */
  isRich: boolean;
  allowMediaHydration: boolean;
  /** Emoji hydration for the rich body, reactions and files. */
  allowInlineEmojiHydration: boolean;
  /** Emoji hydration for the lite paint text. */
  hydrateInlineEmoji: boolean;
  onPress: () => void;
  onLongPress?: (() => void) | undefined;
  /** Shows the thread strip and the hook that joins it to the avatar. */
  onThreadPress?: (() => void) | undefined;
  /** Joins the block above: no avatar or header, words close under the last element. */
  isContinuation?: boolean | undefined;
  /** The row's pressable, so the hold menu can measure where to lift it from. */
  rowRef?: Ref<View> | undefined;
};

/**
 * A message as a flat block: avatar left, name and time on a header line, the
 * words below, and any reactions, files or thread under the words.
 *
 * The words, mentions, forwards, link previews and media are the shared v2
 * parts, mounted inside the same composer root the bubble uses; only the
 * arrangement around them is new.
 */
export const FlatMessage = memo(function FlatMessage(props: FlatMessageProps): ReactElement {
  const tokens = useConversationRenderTokens();

  return (
    <ChatRenderProvider value={tokens}>
      <ConversationComposer.Root
        item={props.conversation}
        currentUser={props.currentUser}
        allowMediaHydration={props.allowMediaHydration}
        allowInlineEmojiHydration={props.allowInlineEmojiHydration}
        isContentExpanded={props.isContentExpanded}
        onContentExpanded={props.onContentExpanded}
        paintRow={props.paintRow}
        {...(props.channelType !== undefined ? { channelType: props.channelType } : {})}
      >
        <FlatMessageLayout {...props} />
      </ConversationComposer.Root>
    </ChatRenderProvider>
  );
});

function FlatMessageLayout({
  paintRow,
  conversation,
  currentUser,
  isContentExpanded,
  onContentExpanded,
  isRich,
  allowInlineEmojiHydration,
  hydrateInlineEmoji,
  onPress,
  onLongPress,
  onThreadPress,
  isContinuation = false,
  rowRef,
}: FlatMessageProps): ReactElement {
  const { summary, parentMessage, shouldIgnoreBubblePress } = useConversationComposer();
  const profileActions = useChatUserProfileActionsSheet();
  const sender = paintRow.senderPaintModel;
  const handleNamePress = useOpenSenderProfile({
    userId: sender.senderId,
    displayName: sender.displayName,
  });
  const isSelf = sender.isCurrentUser || paintRow.rowKind === 'CURRENT_USER';
  const isDeleted = !!summary?.isDeleted || !!paintRow.isDeleted;
  const replyCount = parentMessage ? 0 : (paintRow.replyPreview?.count ?? paintRow.replyCount);
  const showThread = !!onThreadPress && replyCount > 0 && !isDeleted;
  const hasWords = paintRow.body.markdown.trim().length > 0;
  const isAgent = useSenderIsAgent(sender.senderId);
  const hasReactions = (paintRow.reactionPreview?.reactions.length ?? 0) > 0;

  const handlePress = useCallback((): void => {
    if (shouldIgnoreBubblePress()) return;
    onPress();
  }, [onPress, shouldIgnoreBubblePress]);

  return (
    <Pressable
      ref={rowRef}
      accessibilityRole='button'
      onPress={handlePress}
      {...(onLongPress ? { onLongPress } : {})}
      delayLongPress={LONG_PRESS_DELAY_MS}
      className='flex-row'
      style={isContinuation ? getContinuationRowStyle : getRowStyle}
    >
      <View style={{ width: MESSAGE_AVATAR_SIZE }}>
        {isContinuation ? null : <MessageAvatar paintRow={paintRow} />}
        {showThread ? (
          // Starts under the avatar (or at the top of a continuation, which has
          // none) and ends level with the strip's centre, so it reads as the
          // author's thread. The strip is a fixed height for this.
          <View
            className='flex-1 border-b border-l border-spaces-outline'
            style={{
              marginTop: isContinuation ? 0 : THREAD_HOOK_TOP_GAP,
              marginBottom: THREAD_STRIP_HEIGHT / 2,
              marginLeft: MESSAGE_AVATAR_SIZE / 2,
              width: MESSAGE_AVATAR_SIZE / 2 + MESSAGE_GAP,
              borderBottomLeftRadius: THREAD_HOOK_RADIUS,
            }}
          />
        ) : null}
      </View>

      <View className='min-w-0 flex-1'>
        {isContinuation ? (
          isDeleted ? null : (
            // No header to carry them, so they sit at the top right without taking height.
            <View
              pointerEvents='none'
              className='absolute right-0 top-0 flex-row items-center'
              style={{ columnGap: MESSAGE_HEADER_GAP }}
            >
              <ConversationComposer.Edited />
              <ConversationComposer.Bookmarked />
              <ConversationComposer.Pinned />
            </View>
          )
        ) : (
          <View className='mb-0.5 flex-row items-center' style={{ columnGap: MESSAGE_HEADER_GAP }}>
            <Text
              className='min-w-0 shrink text-[16px] font-medium leading-5 tracking-[-0.24px] text-spaces-foreground'
              numberOfLines={1}
              {...(profileActions && sender.senderId ? { onPress: handleNamePress } : {})}
            >
              {isSelf ? 'You' : sender.displayName}
            </Text>
            {isAgent ? <AgentTag /> : null}
            <PaintTimeLabel
              messageId={paintRow.messageId}
              timeLabel={lowerMeridiem(paintRow.timeLabel)}
              textClass='text-[14px] leading-[18px] text-spaces-subtle'
            />
            {isDeleted ? null : (
              <>
                <ConversationComposer.Edited />
                <ConversationComposer.Bookmarked />
                <ConversationComposer.Pinned />
              </>
            )}
          </View>
        )}

        {isDeleted ? (
          <ConversationComposer.Deleted />
        ) : (
          <>
            <ConversationComposer.RepliedToThread />
            <ConversationComposer.Forwarded className='mb-2.5' />
            <View style={{ marginBottom: hasWords ? -CONTENT_INNER_MARGIN : 0 }}>
              {isRich ? (
                <ConversationComposer.Content />
              ) : hasWords ? (
                <PaintPreviewText
                  key={paintRow.conversationId}
                  row={paintRow}
                  className='mb-2.5'
                  hydrateInlineEmoji={hydrateInlineEmoji}
                  isExpanded={isContentExpanded}
                  onExpand={onContentExpanded}
                />
              ) : null}
            </View>
            {paintRow.linkPreview ? (
              <View style={{ marginTop: MESSAGE_EXTRAS_GAP }}>
                <ConversationComposer.LinkPreview flat />
              </View>
            ) : null}
            <MessageAttachments />
            {paintRow.allAttachmentsDeleted ? (
              <Text
                className='text-[16px] italic leading-5 text-spaces-subtle'
                style={{ marginTop: MESSAGE_EXTRAS_GAP }}
              >
                {DELETED_ATTACHMENT_PLACEHOLDER}
              </Text>
            ) : null}
            {hasReactions ? (
              <View style={{ marginTop: MESSAGE_EXTRAS_GAP }}>
                <ReactionChips
                  paintRow={paintRow}
                  currentUser={currentUser}
                  hydrateCustomEmoji={isRich ? allowInlineEmojiHydration : hydrateInlineEmoji}
                />
              </View>
            ) : null}
            {showThread ? (
              <View style={{ marginTop: MESSAGE_EXTRAS_GAP }}>
                <ThreadStrip
                  paintRow={paintRow}
                  lastActivityAt={conversation.lastActivityAt}
                  onPress={onThreadPress}
                />
              </View>
            ) : null}
          </>
        )}
      </View>
    </Pressable>
  );
}
