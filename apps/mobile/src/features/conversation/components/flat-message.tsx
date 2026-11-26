import { memo, useCallback, useMemo, type ReactElement, type Ref } from 'react';
import {
  Pressable,
  Text,
  View,
  type AccessibilityActionEvent,
  type AccessibilityActionInfo,
  type PressableStateCallbackType,
} from 'react-native';
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
import type { LongMessagePresentation } from '@/src/features/chat/v2/components/conversation-composer/long-message-presentation';
import type { ChatPaintRow } from '@/src/features/chat/v2/paint/chatPaint.types';
import { DELETED_ATTACHMENT_PLACEHOLDER } from '@/src/utils/activeAttachments';

import {
  BODY_GUARD_LINE_HEIGHT,
  COLLAPSE_FADE_HEIGHT,
  CONTINUATION_TOP_OFFSET,
  MESSAGE_EXTRAS_GAP,
  MESSAGE_GAP,
  MESSAGE_HEADER_GAP,
  MESSAGE_AVATAR_SIZE,
  MESSAGE_BODY_LINE_HEIGHT,
  CONTENT_INNER_MARGIN,
  THREAD_HOOK_RADIUS,
  THREAD_HOOK_TOP_GAP,
  THREAD_STRIP_HEIGHT,
  READ_MORE_TEXT_STYLE,
  LONG_PRESS_DELAY_MS,
  PRESSED_OPACITY,
} from '../constants';
import { useSenderIsAgent } from '../hooks/use-sender-is-agent';
import type { AgentPlan } from '../model/agent-plan';
import { bodyEndsWithGuardLine } from '../model/body-end-guard';
import { flatCollapse } from '../model/collapse';
import { lowerMeridiem } from '../model/message-time';
import { parsePullRequestUrl } from '../model/pull-request';
import { AgentPlanCard } from './agent-plan-card';
import { AgentTag } from './agent-tag';
import {
  useConversationBodyWidth,
  useConversationPalette,
  useConversationRenderTokens,
} from './conversation-palette';
import { MessageAttachments } from './message-attachments';
import { MessageAvatar } from './message-avatar';
import {
  getMessageRowStyle,
  MESSAGE_HEADER_CLASS,
  MESSAGE_HEADER_STYLE,
  MESSAGE_META_TEXT_CLASS,
  MESSAGE_NAME_TEXT_CLASS,
  MESSAGE_ROW_STYLE,
} from './message-row-style';
import { PullRequestCard } from './pull-request-card';
import { ReactionChips } from './reaction-chips';
import { SendFailedNote } from './send-failed-note';
import { ThreadStrip } from './thread-strip';
import { TicketCard } from './ticket-card';

// A continuation has no top padding of its own and pulls up under the row above.
const CONTINUATION_ROW_STYLE = {
  ...MESSAGE_ROW_STYLE,
  paddingTop: 0,
  marginTop: CONTINUATION_TOP_OFFSET,
} as const;
const CONTINUATION_ROW_PRESSED_STYLE = {
  ...CONTINUATION_ROW_STYLE,
  opacity: PRESSED_OPACITY,
} as const;

// A continuation has no header, so its marks sit level with the first line beside the words.
const MARKS_STYLE = { columnGap: MESSAGE_HEADER_GAP } as const;
const MARKS_ON_LINE_STYLE = { ...MARKS_STYLE, height: MESSAGE_BODY_LINE_HEIGHT } as const;

const getContinuationRowStyle = ({
  pressed,
}: PressableStateCallbackType): typeof CONTINUATION_ROW_STYLE =>
  pressed ? CONTINUATION_ROW_PRESSED_STYLE : CONTINUATION_ROW_STYLE;

type FlatMessageProps = {
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
  /** Makes the ticket card its own tap target (the thread's parent ticket); otherwise the row's tap opens it. */
  onTicketPress?: (() => void) | undefined;
  /**
   * The lone agent plan the message carries, drawn as its card in place of the
   * words. The row parses it once (see `useRowFlow`), so this never parses.
   */
  plan?: AgentPlan | null | undefined;
  /** Joins the block above: no avatar or header, words close under the last element. */
  isContinuation?: boolean | undefined;
  /**
   * Drawn on its own, as the hold menu's lifted copy: a continuation keeps the
   * full top padding, since there is no row above it to pull up under.
   */
  isLifted?: boolean | undefined;
  /** The row's pressable, so the hold menu can measure where to lift it from. */
  rowRef?: Ref<View> | undefined;
  /** Screen-reader stand-ins for gestures the row offers (its swipes). */
  accessibilityActions?: readonly AccessibilityActionInfo[] | undefined;
  onAccessibilityAction?: ((event: AccessibilityActionEvent) => void) | undefined;
};

/** Everything that shapes the message, without its handlers: what the hold menu's still copy takes. */
export type FlatMessageContentProps = Omit<
  FlatMessageProps,
  | 'onPress'
  | 'onLongPress'
  | 'onThreadPress'
  | 'onTicketPress'
  | 'rowRef'
  | 'accessibilityActions'
  | 'onAccessibilityAction'
>;

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
  onTicketPress,
  plan = null,
  isContinuation = false,
  isLifted = false,
  rowRef,
  accessibilityActions,
  onAccessibilityAction,
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
  // The rich body's invisible end line (after a list or code block) is pulled
  // back up, so the extras sit as close under it as under a plain paragraph.
  const guardLift = useMemo(
    () => (isRich && bodyEndsWithGuardLine(paintRow.body.markdown) ? BODY_GUARD_LINE_HEIGHT : 0),
    [isRich, paintRow.body.markdown],
  );
  const isAgent = useSenderIsAgent(sender.senderId);
  const hasReactions = (paintRow.reactionPreview?.reactions.length ?? 0) > 0;
  const bodyWidth = useConversationBodyWidth();
  const { readMore, rowBackground, codeBlock } = useConversationPalette();
  const pullRequest = useMemo(
    () => (paintRow.linkPreview ? parsePullRequestUrl(paintRow.linkPreview.url) : null),
    [paintRow.linkPreview],
  );
  const presentation = useMemo<LongMessagePresentation>(
    () => ({
      collapse: flatCollapse(paintRow, bodyWidth),
      readMoreTextStyle: { ...READ_MORE_TEXT_STYLE, color: readMore },
      fade: { color: rowBackground, height: COLLAPSE_FADE_HEIGHT },
    }),
    [bodyWidth, paintRow, readMore, rowBackground],
  );

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
      {...(accessibilityActions && onAccessibilityAction
        ? { accessibilityActions, onAccessibilityAction }
        : {})}
      delayLongPress={LONG_PRESS_DELAY_MS}
      className='flex-row'
      style={isContinuation && !isLifted ? getContinuationRowStyle : getMessageRowStyle}
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
        {isContinuation ? null : (
          <View className={MESSAGE_HEADER_CLASS} style={MESSAGE_HEADER_STYLE}>
            <Text
              className={MESSAGE_NAME_TEXT_CLASS}
              numberOfLines={1}
              {...(profileActions && sender.senderId ? { onPress: handleNamePress } : {})}
            >
              {isSelf ? 'You' : sender.displayName}
            </Text>
            {isAgent ? <AgentTag /> : null}
            <PaintTimeLabel
              messageId={paintRow.messageId}
              timeLabel={lowerMeridiem(paintRow.timeLabel)}
              textClass={MESSAGE_META_TEXT_CLASS}
            />
            {isDeleted ? null : <MessageMarks />}
          </View>
        )}

        {isDeleted ? (
          <ConversationComposer.Deleted />
        ) : (
          <>
            <ConversationComposer.RepliedToThread />
            <ConversationComposer.Forwarded className='mb-2.5' />
            <ContinuationMarksRow isContinuation={isContinuation} hasWords={hasWords}>
              {plan ? (
                // An agent's plan is drawn as its own card in place of the words.
                <View className='mt-1'>
                  <AgentPlanCard key={paintRow.messageId} plan={plan} />
                </View>
              ) : (
                <View style={{ marginBottom: hasWords ? -CONTENT_INNER_MARGIN - guardLift : 0 }}>
                  {isRich ? (
                    <ConversationComposer.Content
                      lineHeight={MESSAGE_BODY_LINE_HEIGHT}
                      presentation={presentation}
                      codeBlockStyle={codeBlock}
                    />
                  ) : hasWords ? (
                    <PaintPreviewText
                      key={paintRow.conversationId}
                      row={paintRow}
                      className='mb-2.5'
                      hydrateInlineEmoji={hydrateInlineEmoji}
                      lineHeight={MESSAGE_BODY_LINE_HEIGHT}
                      presentation={presentation}
                      isExpanded={isContentExpanded}
                      onExpand={onContentExpanded}
                    />
                  ) : null}
                </View>
              )}
            </ContinuationMarksRow>
            {paintRow.ticketPreview ? (
              // A ticket row has no words, so its card sits right under the header.
              <View style={hasWords ? { marginTop: MESSAGE_EXTRAS_GAP } : undefined}>
                <TicketCard
                  ticket={paintRow.ticketPreview}
                  ticketMd={conversation.ticket_md}
                  onPress={onTicketPress}
                  onLongPress={onTicketPress ? onLongPress : undefined}
                />
              </View>
            ) : null}
            {paintRow.linkPreview ? (
              <View style={{ marginTop: MESSAGE_EXTRAS_GAP }}>
                {pullRequest ? (
                  <PullRequestCard
                    preview={paintRow.linkPreview}
                    pullRequest={pullRequest}
                    onLongPress={onLongPress}
                  />
                ) : (
                  <ConversationComposer.LinkPreview flat />
                )}
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
            <SendFailedNote messageId={paintRow.messageId} marginTop={MESSAGE_EXTRAS_GAP} />
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

/** "(edited)" in the header's quiet text, for the same messages the shared mark covers. */
function EditedMark(): ReactElement | null {
  const { summary, kind } = useConversationComposer();
  if (kind !== 'CURRENT_USER' && kind !== 'OTHER_USER') return null;
  if (!summary?.edited) return null;
  return <Text className={MESSAGE_META_TEXT_CLASS}>(edited)</Text>;
}

/** Edited, bookmarked and pinned; each draws nothing when it does not apply. */
function MessageMarks(): ReactElement {
  return (
    <>
      <EditedMark />
      <ConversationComposer.Bookmarked />
      <ConversationComposer.Pinned />
    </>
  );
}

/**
 * A continuation has no header to carry its marks, so they follow the words
 * on the right, taking their own width so a full first line never runs under
 * them. A full row's words are passed through as they are.
 */
function ContinuationMarksRow({
  isContinuation,
  hasWords,
  children,
}: {
  isContinuation: boolean;
  hasWords: boolean;
  children: ReactElement;
}): ReactElement {
  if (!isContinuation) return children;
  return (
    <View className='flex-row' style={MARKS_STYLE}>
      <View className='min-w-0 flex-1'>{children}</View>
      <View className='flex-row items-center' style={hasWords ? MARKS_ON_LINE_STYLE : MARKS_STYLE}>
        <MessageMarks />
      </View>
    </View>
  );
}
