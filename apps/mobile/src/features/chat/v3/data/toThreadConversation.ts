import { MessageType, isForwardedMessageXml, serializeInitialMessageMd } from '@xyne/shared';

import type { Conversation } from './normalizeConversationWindow';

const isKnownMessageType = (value: unknown): value is MessageType =>
  value === MessageType.USER ||
  value === MessageType.BOT ||
  value === MessageType.SYSTEM ||
  value === MessageType.FORWARDED;

const messageTypeOf = (value: unknown, content: string): MessageType => {
  if (isKnownMessageType(value)) {
    return value;
  }
  if (isForwardedMessageXml(content)) {
    return MessageType.FORWARDED;
  }
  return MessageType.USER;
};

const threadMessageId = (
  raw: Record<string, unknown>,
  _index: number,
  threadId: string,
): string => {
  const messageId = raw['messageId'];
  if (typeof messageId === 'string' && messageId.length > 0) {
    return messageId;
  }
  const initialMessageId = raw['initialMessageId'];
  if (typeof initialMessageId === 'string' && initialMessageId.length > 0) {
    return initialMessageId;
  }
  const createdAt = raw['createdAt'];
  throw new Error(
    `Thread reply is missing messageId for ${threadId} at createdAt=${String(createdAt)}`,
  );
};

/**
 * v2 `toThreadPaintConversation`. Thread `useMessages` rows are MessageItems
 * (`content`), not channel conversations (`initial_message_md`). The paint
 * mapper only understands the conversation shape.
 */
export const toThreadConversation = (
  message: Conversation,
  channelId: string,
  threadId: string,
  index = 0,
): Conversation => {
  const raw = message as unknown as Record<string, unknown>;
  const messageId = threadMessageId(raw, index, threadId);
  const createdAt = typeof raw['createdAt'] === 'number' ? raw['createdAt'] : 0;
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
  const existingMd = raw['initial_message_md'];
  const initialMessageMd =
    typeof existingMd === 'string' && existingMd.length > 0
      ? existingMd
      : (serializeInitialMessageMd({
          messageId,
          conversationId: threadId,
          senderId,
          content,
          msgType: messageTypeOf(raw['msgType'] ?? raw['type'], content),
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
    replyCount:
      index === 0 && typeof raw['replyCount'] === 'number' && Number.isFinite(raw['replyCount'])
        ? raw['replyCount']
        : index === 0 &&
            typeof raw['repliesCount'] === 'number' &&
            Number.isFinite(raw['repliesCount'])
          ? raw['repliesCount']
          : 0,
  } as unknown as Conversation;
};
