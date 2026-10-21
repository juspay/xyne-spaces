import { createContext, useContext } from 'react';
import { format } from 'date-fns';
import { MessageType } from '@xyne/shared';
import type {
  MessageContextValue,
  MessageRootProps,
  SenderFromConversation,
  MessageForRender,
  ConversationType,
} from './message.types';
import { useUser } from '@/src/hooks/useUsers';
import { formatChatDateLabel } from '@/src/components/chat/date-pill/date-pill.utils';

export const MessageContext = createContext<MessageContextValue | undefined>(undefined);

export function useMessageContext(): MessageContextValue {
  const ctx = useContext(MessageContext);
  if (!ctx) {
    throw new Error('useMessageContext must be used within a <Message.Root>');
  }
  return ctx;
}

export function getSenderFromConversation(
  message: MessageRootProps['message'],
): SenderFromConversation | null {
  const initialMessage = message.initialMessage;
  if (!initialMessage) return null;
  // Legacy V1 may attach `sender` from a relation; V2 / MD rows only guarantee `senderId` (see useSender + useUser).
  if ('sender' in initialMessage && initialMessage.sender) {
    return initialMessage.sender;
  }
  return null;
}

export function useSender(): SenderFromConversation | null {
  const { message } = useMessageContext();
  const explicit = getSenderFromConversation(message);
  const senderId = message.initialMessage?.senderId ?? '';
  const userFromStore = useUser(senderId);

  if (explicit) return explicit;
  if (userFromStore && senderId) {
    return {
      id: userFromStore.id,
      name: userFromStore.name,
      picture: userFromStore.picture ?? '',
    };
  }
  return null;
}

// Add new hook to get conversation type
export function useConversationType(): ConversationType {
  const { conversationType } = useMessageContext();
  return conversationType ?? 'channel';
}

const getInitialMessage = (
  message: MessageRootProps['message'],
): MessageRootProps['message']['initialMessage'] => message.initialMessage;

export const getIsOwnMessage = (message: MessageRootProps['message']): boolean => {
  const initialMessage = getInitialMessage(message);
  return !!initialMessage && initialMessage.senderId === message.currentUserId;
};

function getMetadataRecord(
  metadata: MessageForRender['initialMessage'] extends { metadata?: infer M } | undefined
    ? M
    : undefined,
): Record<string, unknown> | null {
  if (metadata === undefined || metadata === null) return null;
  if (typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  return metadata as Record<string, unknown>;
}

export const isTicketMessage = (message: MessageForRender): boolean => {
  if (messageRowHasLinkedTicket(message)) return true;
  const meta = getMetadataRecord(message.initialMessage?.metadata);
  if (meta === null) return false;
  const isTicketActivity = meta['isTicketActivity'] === true;
  return meta['ticketId'] !== undefined && !isTicketActivity;
};

export function getMessageMsgType(message: MessageForRender): MessageType {
  return message.initialMessage?.msgType ?? MessageType.USER;
}

/**
 * Matches dashboard `showEdited={message.edited}` on `RenderMessageWithHTML`:
 * small "(edited)" after content — not for system rows or deleted messages.
 */
export function shouldShowMessageEditedLabel(
  message: MessageForRender,
  msgType: MessageType,
): boolean {
  const im = message.initialMessage;
  if (!im?.edited) return false;
  if (im.isDeleted) return false;
  if (msgType === MessageType.SYSTEM) return false;
  return true;
}

export const getTicketData = (message: MessageForRender) => {
  // V2 channel rows omit `ticket`; thread / V1 rows may include it (see MessageDataLike).
  if (!('ticket' in message) || !message.ticket) return null;
  return message.ticket;
};

export const getTicketIdFromMetadata = (message: MessageForRender): string | null => {
  const meta = getMetadataRecord(message.initialMessage?.metadata);
  if (meta?.['isTicketActivity'] === true) return null;
  const ticketId = meta?.['ticketId'];
  return typeof ticketId === 'string' && ticketId.trim().length > 0 ? ticketId : null;
};

/** True if this conversation row is already linked to a ticket (nested relation and/or `ticketId` on the row). */
export function messageRowHasLinkedTicket(m: MessageForRender): boolean {
  if ('ticket' in m && m.ticket !== null && m.ticket !== undefined) return true;
  if ('ticketId' in m && m.ticketId !== null && m.ticketId !== undefined && m.ticketId !== '')
    return true;
  return false;
}

export const getMessageText = (message: MessageRootProps['message']): string => {
  return getInitialMessage(message)?.content || '';
};

export const getMessageTime = (message: MessageRootProps['message']): string => {
  const createdAt = getInitialMessage(message)?.createdAt ?? message.createdAt;
  return format(new Date(createdAt), 'h:mm a');
};

export const formatDateLabel = (timestamp: number): string => {
  return formatChatDateLabel(timestamp, {
    order: 'day-month',
    relativeLabels: false,
    year: 'never',
  });
};

export const isSameDay = (a: number, b: number): boolean => {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
};

/**
 * Determines whether a message is the "new message boundary" —
 * the first message the user hasn't seen yet.
 * Mirrors the dashboard's `computeNewConvIdx` logic but works per-message
 * using `previousMessage` to detect the boundary transition.
 */
export const isNewMessageBoundary = (
  message: MessageForRender,
  previousMessage: MessageForRender | undefined,
  lastViewedAt: number | undefined,
): boolean => {
  if (!lastViewedAt || lastViewedAt <= 0) return false;
  if (message.createdAt <= lastViewedAt) return false;
  if (message.initialMessage?.senderId === message.currentUserId) return false;
  const msgType = getMessageMsgType(message);
  if (msgType === MessageType.SYSTEM && !isTicketMessage(message)) return false;
  if (previousMessage && previousMessage.createdAt > lastViewedAt) return false;
  return true;
};

export { getInitialMessage };
