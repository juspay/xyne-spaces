import { parseForwardedMessageXml } from '@xyne/shared';

/** The ids a forwarded message refers to; all null when the content is not a forwarded message. */
export interface ForwardedRefs {
  messageId: string | null;
  conversationId: string | null;
  channelId: string | null;
  senderId: string | null;
}

/** The references of a forwarded-message XML body (forwardedMessage.ts), never its text. */
export function extractForwardedRefs(text: string): ForwardedRefs {
  const parsed = parseForwardedMessageXml(text);
  return {
    messageId: parsed?.originalMessageId ?? null,
    conversationId: parsed?.originalConversationId ?? null,
    channelId: parsed?.originalChannelId ?? null,
    senderId: parsed?.originalSenderId ?? null,
  };
}
