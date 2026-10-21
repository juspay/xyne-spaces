import { MessageType, isForwardedMessageXml, serializeInitialMessageMd } from '@xyne/shared';

import type { MessageItem } from '@/src/components/message-composer';
import type { ConversationItem } from '@/src/features/chat/v2/components/conversation-composer';
import type { MediaPreviewRequest } from '@/src/features/chat/v2/media/mediaPreviewCache';
import type { ChatPaintRow } from '@/src/features/chat/v2/paint/chatPaint.types';
import type { ChatPaintRowBuildSignature } from '@/src/features/chat/v2/paint/buildChatPaintRows';

export type ThreadPaintItem = {
  message: MessageItem;
  conversation: ConversationItem;
  paint: ChatPaintRow;
};

export const getThreadMessageId = (
  message: MessageItem,
  index: number,
  threadId: string,
): string => {
  const raw = message as unknown as Record<string, unknown>;
  const messageId = raw['messageId'];
  if (typeof messageId === 'string' && messageId.length > 0) return messageId;
  const initialMessageId = raw['initialMessageId'];
  if (typeof initialMessageId === 'string' && initialMessageId.length > 0) {
    return initialMessageId;
  }
  const createdAt = raw['createdAt'];
  // Message IDs are the normal identity. The index is only a last-resort
  // uniqueness suffix for malformed rows that have neither message ID nor
  // initial-message ID; such rows cannot provide a stable identity anyway.
  return `${threadId}:${typeof createdAt === 'number' ? createdAt : 'unknown'}:${index}`;
};

const getThreadMessageCreatedAt = (message: MessageItem): number => {
  const createdAt = (message as unknown as Record<string, unknown>)['createdAt'];
  return typeof createdAt === 'number' && Number.isFinite(createdAt) ? createdAt : 0;
};

const isServerAuthoritativeThreadMessage = (message: MessageItem): boolean =>
  (message as unknown as Record<string, unknown>)['isSent'] !== false;

/**
 * Last-mile mobile protection for recycled thread rows. The shared thread
 * merge can temporarily append pending rows after live rows; keep the first
 * message for a duplicate render key, preserve the thread root at index zero,
 * and sort replies before they reach LegendList.
 */
export const dedupeAndSortThreadMessages = (
  messages: readonly MessageItem[],
  threadId: string,
): MessageItem[] => {
  if (messages.length === 0) return [];

  const firstMessageId = getThreadMessageId(messages[0]!, 0, threadId);
  const byMessageId = new Map<string, { message: MessageItem; originalIndex: number }>();
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (!message) continue;
    const messageId = getThreadMessageId(message, index, threadId);
    const current = byMessageId.get(messageId);
    if (
      !current ||
      (!isServerAuthoritativeThreadMessage(current.message) &&
        isServerAuthoritativeThreadMessage(message))
    ) {
      byMessageId.set(messageId, { message, originalIndex: index });
    }
  }

  return Array.from(byMessageId.entries())
    .sort(([leftId, left], [rightId, right]) => {
      if (leftId === firstMessageId) return -1;
      if (rightId === firstMessageId) return 1;
      return (
        getThreadMessageCreatedAt(left.message) - getThreadMessageCreatedAt(right.message) ||
        leftId.localeCompare(rightId) ||
        left.originalIndex - right.originalIndex
      );
    })
    .map(([, entry]) => entry.message);
};

/**
 * A cached thread is usable for an exact open only when it contains the
 * requested message. A partial parent-only window must stay behind the
 * loading surface until the authoritative thread query resolves.
 */
export const isThreadTargetCached = (
  messages: readonly Pick<MessageItem, 'messageId'>[],
  messageId: string | undefined,
): boolean => !messageId || messages.some(message => message.messageId === messageId);

/**
 * Keep an empty thread behind the open placeholder until an exact target is
 * available. The merge policy decides separately whether existing rows are
 * safe to keep visible during that wait.
 */
export const shouldHoldThreadTargetWhileEmpty = ({
  messageId,
  hasWarmTarget,
  hasMessages,
  hasQueryError,
  didUserScroll,
}: {
  messageId: string | undefined;
  hasWarmTarget: boolean;
  hasMessages: boolean;
  hasQueryError: boolean;
  didUserScroll: boolean;
}): boolean =>
  Boolean(messageId && !hasWarmTarget && !hasMessages && !hasQueryError && !didUserScroll);

/**
 * A thread message is incomplete when Zero has synced its identity (messageId,
 * createdAt) but not its content. These partial rows render as blank bubbles.
 * The opening window always has complete rows (fetched via HTTP API or from a
 * previous visit); only live rows need the check.
 */
const isCompleteThreadMessage = (message: MessageItem): boolean => {
  const raw = message as unknown as Record<string, unknown>;
  const content = raw['content'];
  if (typeof content === 'string' && content.length > 0) return true;
  const initialMessageMd = raw['initial_message_md'];
  if (typeof initialMessageMd === 'string' && initialMessageMd.length > 0) return true;
  const attachments = raw['attachments'];
  if (Array.isArray(attachments) && attachments.length > 0) return true;
  const initialAttachments = raw['initialMessageAttachments'];
  if (Array.isArray(initialAttachments) && initialAttachments.length > 0) return true;
  return false;
};

/**
 * Merge the cached opening window with the live query result. Four rules:
 *
 * 1. Live is authoritative once it has settled AND can place the target (or
 *    no target was requested). The settled live result is correct as-is.
 * 2. The user owns the viewport — don't reshuffle under them.
 * 3. Live settled but can't place the target — it's stale. Prefer known-good
 *    opening rows so the surface doesn't freeze or show blank bubbles.
 * 4. Still loading: union of opening + filtered live. Incomplete rows (Zero
 *    synced identity but not body) are filtered only here, where partial
 *    materialization is the actual problem.
 */
export const mergeOpeningThreadMessages = ({
  openingMessages,
  liveMessages,
  messageId,
  liveQueryComplete,
  threadId,
  preserveOpeningWindow = false,
}: {
  openingMessages: readonly MessageItem[];
  liveMessages: MessageItem[];
  messageId: string | undefined;
  liveQueryComplete: boolean;
  threadId: string;
  preserveOpeningWindow?: boolean;
}): MessageItem[] => {
  const liveHasTarget = isThreadTargetCached(liveMessages, messageId);
  const completeLive = liveMessages.filter(isCompleteThreadMessage);

  if (liveQueryComplete && (!messageId || liveHasTarget)) {
    return liveMessages;
  }

  if (preserveOpeningWindow) {
    return openingMessages.length > 0 ? [...openingMessages] : completeLive;
  }

  if (liveQueryComplete) {
    return openingMessages.length > 0 ? [...openingMessages] : completeLive;
  }

  const merged = dedupeAndSortThreadMessages([...openingMessages, ...completeLive], threadId);
  return merged;
};

const isKnownMessageType = (value: unknown): value is MessageType =>
  value === MessageType.USER ||
  value === MessageType.BOT ||
  value === MessageType.SYSTEM ||
  value === MessageType.FORWARDED;

const getThreadMessageType = (value: unknown, content: string): MessageType => {
  if (isKnownMessageType(value)) return value;
  if (isForwardedMessageXml(content)) return MessageType.FORWARDED;
  return MessageType.USER;
};

export const readPositiveCount = (value: unknown): number => {
  const numericValue = typeof value === 'string' ? Number(value) : value;
  if (typeof numericValue !== 'number' || !Number.isFinite(numericValue)) return 0;
  return numericValue > 0 ? Math.floor(numericValue) : 0;
};

export const toThreadPaintConversation = (
  message: MessageItem,
  index: number,
  channelId: string,
  threadId: string,
): ConversationItem => {
  const raw = message as unknown as Record<string, unknown>;
  const messageId = getThreadMessageId(message, index, threadId);
  const createdAt = typeof raw['createdAt'] === 'number' ? raw['createdAt'] : Date.now();
  const content = typeof raw['content'] === 'string' ? raw['content'] : '';
  const senderId =
    typeof raw['senderId'] === 'string'
      ? raw['senderId']
      : typeof raw['createdBy'] === 'string'
        ? raw['createdBy']
        : '';
  const attachments = Array.isArray(raw['initialMessageAttachments'])
    ? raw['initialMessageAttachments']
    : Array.isArray(raw['attachments'])
      ? raw['attachments']
      : [];
  const metadata =
    typeof raw['metadata'] === 'string'
      ? raw['metadata']
      : raw['metadata']
        ? JSON.stringify(raw['metadata'])
        : null;
  const initialMessageMd =
    typeof raw['initial_message_md'] === 'string' && raw['initial_message_md'].length > 0
      ? raw['initial_message_md']
      : (serializeInitialMessageMd({
          messageId,
          conversationId: threadId,
          senderId,
          content,
          msgType: getThreadMessageType(raw['msgType'] ?? raw['type'], content),
          hasAttachment:
            attachments.length > 0 ||
            (typeof raw['hasAttachment'] === 'boolean' ? raw['hasAttachment'] : false),
          edited: typeof raw['edited'] === 'boolean' ? raw['edited'] : false,
          isDeleted: typeof raw['isDeleted'] === 'boolean' ? raw['isDeleted'] : false,
          showInChannel: typeof raw['showInChannel'] === 'boolean' ? raw['showInChannel'] : false,
          visibleTo: typeof raw['visibleTo'] === 'string' ? raw['visibleTo'] : null,
          createdAt,
          metadata,
          nudgeCount: typeof raw['nudgeCount'] === 'number' ? raw['nudgeCount'] : null,
          isSent: typeof raw['isSent'] === 'boolean' ? raw['isSent'] : true,
          // eslint-disable-next-line @typescript-eslint/naming-convention
          reactions_md: typeof raw['reactions_md'] === 'string' ? raw['reactions_md'] : null,
          // eslint-disable-next-line @typescript-eslint/naming-convention
          link_preview_md:
            typeof raw['link_preview_md'] === 'string' ? raw['link_preview_md'] : null,
          childConversationId:
            typeof raw['childConversationId'] === 'string' ? raw['childConversationId'] : null,
        }) ?? '');

  return {
    ...raw,
    conversationId: messageId,
    channelId,
    createdAt,
    createdBy: senderId,
    initialMessageId: messageId,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    initial_message_md: initialMessageMd,
    initialMessageAttachments: attachments,
    initialMessageNudgeCounts: Array.isArray(raw['nudgeCounts']) ? raw['nudgeCounts'] : [],
    replyCount: 0,
  } as unknown as ConversationItem;
};

export const withoutThreadReplyChrome = (row: ChatPaintRow): ChatPaintRow => {
  if (row.replyCount === 0 && row.replyAvatarSlots === 0) return row;
  return {
    ...row,
    replyCount: 0,
    replyPreviewUserIds: [],
    replyAvatarSlots: 0,
    contentSignature: `${row.contentSignature}:thread-no-replies` as ChatPaintRowBuildSignature,
  };
};

export const getThreadMediaPreviewRequest = (row: ChatPaintRow): MediaPreviewRequest | null => {
  const media = row.mediaPlaceholder;
  if (!media?.previewAttachmentId || !media.previewAttachmentKind) return null;
  return {
    attachmentId: media.previewAttachmentId,
    kind: media.previewAttachmentKind,
  };
};
