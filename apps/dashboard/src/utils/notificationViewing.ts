// Chat notification types that can be silenced while their target is on screen.
// Keyword matches arrive as MENTION; canvas mentions are excluded via relatedEntityType.
const CHAT_NOTIFICATION_TYPES = new Set([
  'CHANNEL_MESSAGE',
  'DIRECT_MESSAGE',
  'THREAD_REPLY',
  'MENTION',
  'NEW_MESSAGE',
]);

export interface ChatNotificationTarget {
  type: string;
  workspaceId?: string | undefined;
  relatedEntityType?: string | undefined;
  channelId?: string | undefined;
  conversationId?: string | undefined;
  messageId?: string | undefined;
  initialMessageId?: string | undefined;
}

export interface ViewingState {
  pathname: string;
  search: string;
  isAppFocused: boolean;
}

interface OpenChat {
  workspaceId: string;
  channelId: string;
  conversationId?: string | undefined;
  /** Only the thread is on screen (focused thread / Activity), not the channel's messages. */
  threadOnly: boolean;
}

/** Open chat from /:workspaceId/chat/(dir|dm|activity)/:channelId/:conversationId?. */
export function parseOpenChat(pathname: string, search = ''): OpenChat | null {
  const [workspaceId, section, kind, channelId, conversationId] = pathname
    .split('/')
    .filter(Boolean);
  if (!workspaceId || section !== 'chat' || !channelId) return null;
  if (kind !== 'dir' && kind !== 'dm' && kind !== 'activity') return null;
  // Literal child routes (profile, tickets, canvas, …) never equal a real id,
  // so an unrecognised view simply fails to match and the alert still fires.
  const threadOnly = kind === 'activity' || new URLSearchParams(search).get('focusThread') === '1';
  return { workspaceId, channelId, conversationId, threadOnly };
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

  // 1. Only a focused app showing a chat message can be "already seen".
  if (!viewing.isAppFocused) return false;
  if (!CHAT_NOTIFICATION_TYPES.has(type)) return false;
  if (target.relatedEntityType && target.relatedEntityType !== 'message') return false;
  if (!target.channelId || !target.messageId) return false;

  // 2. The same channel must be open, in the same workspace.
  const open = parseOpenChat(viewing.pathname, viewing.search);
  if (!open || open.channelId !== target.channelId) return false;
  if (target.workspaceId && target.workspaceId !== open.workspaceId) return false;

  // 3. Top-level message: shown only when the channel's messages are on screen.
  if (target.initialMessageId && target.messageId === target.initialMessageId) {
    return !open.threadOnly;
  }

  // 4. Thread reply: only an open panel for that thread shows it.
  const isThreadReply = !!target.initialMessageId || type === 'THREAD_REPLY';
  if (!isThreadReply) return false; // can't tell which — alert to be safe
  return !!target.conversationId && open.conversationId === target.conversationId;
}
