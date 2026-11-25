import type { ComponentType, ReactElement } from 'react';
import type { ChannelScopeType, User } from '@xyne/shared';

import type { DatePillProps } from '@/src/components/chat/date-pill';
import type { ChatMessageListRowProps } from '@/src/features/chat/v2/components/chat/chat-message-list-row';
import type { ConversationItem } from '@/src/features/chat/v2/components/conversation-composer';
import type { ChatPaintRow } from '@/src/features/chat/v2/paint/chatPaint.types';

/**
 * What a custom `MessageRow` receives: the classic row's props, plus the paint
 * and conversation of the row directly above when that is a message. The
 * classic row is never given either.
 */
export type ChatMessageRowRendererProps = ChatMessageListRowProps & {
  previousPaint?: ChatPaintRow | undefined;
  /** The conversation behind `previousPaint`, once hydrated. */
  previousConversation?: ConversationItem | undefined;
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
  /** Opens the parent ticket from its card, as the classic thread's ticket card does; only on that row. */
  onTicketPress?: (() => void) | undefined;
  /** The message directly above in the thread, when the row may join its block. */
  previousPaint?: ChatPaintRow | undefined;
  /** The conversation behind `previousPaint`. */
  previousConversation?: ConversationItem | undefined;
  /** This message is open in the composer for editing. */
  isEditing?: boolean | undefined;
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
  /** Replaces the date that floats over the list while it scrolls (ChatList and ChatThread). */
  FloatingDate?: ComponentType<DatePillProps> | undefined;
  /** Fixed height of the replaced date row; unset keeps the row dynamically measured. */
  dateRowHeight?: number | undefined;
  /** Fixed height of the replaced unread divider row. */
  unreadDividerHeight?: number | undefined;
  /** Formats ChatThread's date rows and floating date; unset keeps `formatDateLabel`. */
  formatThreadDate?: ((timestamp: number) => string) | undefined;
  /** False drops the date row above the thread's root message (ChatThread); unset keeps it. */
  showThreadRootDate?: boolean | undefined;
  /** Replaces the "N replies" divider under the thread's root message (ChatThread). */
  ReplyDivider?: ComponentType<{ replyCount: number }> | undefined;
  /**
   * Replaces the per-row height estimate that seeds the list's item size
   * (ChatList). `previous` is the message row directly above, when there is one.
   */
  estimateMessageHeight?: ((row: ChatPaintRow, previous?: ChatPaintRow) => number) | undefined;
  /**
   * How far past the screen the list keeps rows drawn (ChatList and
   * ChatThread), so a fast fling lands on rows rather than blank space. Unset
   * keeps each list's own value.
   */
  listDrawDistance?: number | undefined;
  /** Replaces each block of skeleton rows the list shows while it first opens (ChatList and ChatThread). */
  Skeleton?: ComponentType | undefined;
  /**
   * Replaces the words of the list's full-screen notices: the failed first
   * load, an unavailable or unplaceable message (ChatList and ChatThread). The
   * overlay around them, and when it shows, stay the list's.
   */
  ListNotice?: ComponentType<ChatListNoticeProps> | undefined;
  /**
   * Drawn when the list has loaded and holds no messages. ChatList shows
   * nothing there without it; ChatThread keeps its "No messages yet" line.
   */
  ListEmpty?: ComponentType<ChatListEmptyProps> | undefined;
};

export type ChatListNoticeProps = {
  title: string;
  detail?: string | undefined;
  /** Shows a "Try again" action; the notice is not interactive without it. */
  onRetry?: (() => void) | undefined;
};

export type ChatListEmptyProps = {
  surface: 'channel' | 'thread';
};
