import type { ComponentType, ReactElement } from 'react';
import type { ChannelScopeType, User } from '@xyne/shared';

import type { DatePillProps } from '@/src/components/chat/date-pill';
import type { ChatMessageListRowProps } from '@/src/features/chat/v2/components/chat/chat-message-list-row';
import type { ConversationItem } from '@/src/features/chat/v2/components/conversation-composer';
import type { ChatPaintRow } from '@/src/features/chat/v2/paint/chatPaint.types';

/**
 * What a custom `MessageRow` receives: the classic row's props, plus the paint
 * of the row directly above when that is a message. The classic row is never
 * given `previousPaint`.
 */
export type ChatMessageRowRendererProps = ChatMessageListRowProps & {
  previousPaint?: ChatPaintRow | undefined;
};

export type ThreadMessageRowProps = {
  paintRow: ChatPaintRow;
  conversation: ConversationItem;
  currentUser: User | undefined;
  channelType?: ChannelScopeType | undefined;
  isContentExpanded: boolean;
  /**
   * What the classic thread draws for this message, with its full gating and
   * handlers. A renderer returns it for rows it does not restyle.
   */
  classicContent: ReactElement;
  /** True once the classic thread would draw the rich composer instead of the paint row. */
  showRichContent: boolean;
  allowMediaHydration: boolean;
  allowInlineEmojiHydration: boolean;
  /** Inline emoji hydration for the paint row, used while `showRichContent` is false. */
  hydrateInlineEmoji: boolean;
  onContentExpanded: (conversationId: string) => void;
  onPress: () => void;
  onLongPress?: (() => void) | undefined;
  /** The message directly above in the thread, when the row may join its block. */
  previousPaint?: ChatPaintRow | undefined;
};

export type ChatRowRenderers = {
  /** Replaces ChatMessageListRow in ChatList. */
  MessageRow?: ComponentType<ChatMessageRowRendererProps> | undefined;
  /** Replaces the message content of each ChatThread row (date/reply dividers stay). */
  ThreadMessageRow?: ComponentType<ThreadMessageRowProps> | undefined;
  /** Replaces UnreadMessagesDivider in ChatList. */
  UnreadDivider?: ComponentType | undefined;
  /** Replaces the date separator row (ChatList) or inline date pill block (ChatThread). */
  DateRow?: ComponentType<DatePillProps> | undefined;
  /** Fixed height of the replaced date row; unset keeps the row dynamically measured. */
  dateRowHeight?: number | undefined;
  /** Fixed height of the replaced unread divider row. */
  unreadDividerHeight?: number | undefined;
  /** Replaces the "N replies" divider under the thread's root message (ChatThread). */
  ReplyDivider?: ComponentType<{ replyCount: number }> | undefined;
  /**
   * Replaces the per-row height estimate that seeds the list's item size
   * (ChatList). `previous` is the message row directly above, when there is one.
   */
  estimateMessageHeight?: ((row: ChatPaintRow, previous?: ChatPaintRow) => number) | undefined;
};
