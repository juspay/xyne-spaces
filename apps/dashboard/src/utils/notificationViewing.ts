// Chat notification types that can be silenced while their target is on screen.
// Keyword matches arrive as MENTION; canvas mentions are excluded via relatedEntityType.
const CHAT_NOTIFICATION_TYPES = new Set([
  'CHANNEL_MESSAGE',
  'DIRECT_MESSAGE',
  'THREAD_REPLY',
  'MENTION',
]);

export interface ChatNotificationTarget {
  type: string;
  relatedEntityType?: string | undefined;
  channelId?: string | undefined;
  conversationId?: string | undefined;
  messageId?: string | undefined;
  initialMessageId?: string | undefined;
}

export interface ViewingState {
  isAppFocused: boolean;
  /** Channel whose message list ChatView shows, uncovered. */
  listChannelId: string | null;
  /** Thread whose replies ChatView shows, uncovered. */
  threadId: string | null;
}

/**
 * True when the user is already looking at where this message landed, so its
 * sound and banner would only interrupt them. Unknown cases return false.
 */
export function isViewingNotificationTarget(
  target: ChatNotificationTarget,
  viewing: ViewingState,
): boolean {
  const type = target.type.toUpperCase();

  if (!viewing.isAppFocused) return false;
  if (!CHAT_NOTIFICATION_TYPES.has(type)) return false;
  if (target.relatedEntityType && target.relatedEntityType !== 'message') return false;
  if (!target.channelId || !target.messageId) return false;

  // Top-level message: shown by the channel's message list.
  if (target.initialMessageId && target.messageId === target.initialMessageId) {
    return viewing.listChannelId === target.channelId;
  }

  // Thread reply: shown only by that thread's panel.
  const isThreadReply = !!target.initialMessageId || type === 'THREAD_REPLY';
  if (!isThreadReply) return false; // can't tell which — alert to be safe
  return !!target.conversationId && viewing.threadId === target.conversationId;
}
