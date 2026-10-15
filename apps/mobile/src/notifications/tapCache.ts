/** Notification route helpers kept independent from navigation lifecycle state. */
import { getCachedThreadTicketId } from '@/src/features/chat/navigation/threadTicketSurface';

import { resolveTicketId } from './message/messageContext';
import type { ChatRouteTarget, ParsedMessage } from './types';

export const LOTUS_USER_ID_STORAGE_KEY = '@lotus_user_id';

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

/** FCM identity for header-resolve logs. Uses the server notification id, not the tray grouping slot. */
function fcmLogFieldsFromMessage(
  message: ParsedMessage,
): Pick<ChatRouteTarget, 'notificationId' | 'notificationType' | 'metadata'> {
  const notificationId =
    readNonEmptyString(message.backendNotificationId) ??
    readNonEmptyString(message.rawData['notificationId']);
  const notificationType =
    readNonEmptyString(message.type) ?? readNonEmptyString(message.rawData['type']);
  const metadata = readNonEmptyString(message.rawData['metadata']);
  return {
    ...(notificationId ? { notificationId } : {}),
    ...(notificationType ? { notificationType } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

const ticketIdForMessage = (message: ParsedMessage, threadId?: string): string | undefined => {
  const fromPayload = resolveTicketId(message.rawData);
  if (fromPayload) {
    return fromPayload;
  }
  if (!threadId) {
    return undefined;
  }
  return getCachedThreadTicketId({ channelId: message.channelId, threadId }) ?? undefined;
};

export function toRouteTargetFromMessage(message: ParsedMessage): ChatRouteTarget | null {
  if (!message.channelId.trim()) return null;
  const threadId = message.isThread ? (message.threadId ?? message.conversationId) : undefined;
  const ticketId = ticketIdForMessage(message, threadId);
  return {
    channelId: message.channelId,
    ...(ticketId ? { ticketId } : {}),
    ...(threadId ? { threadId } : {}),
    ...(!threadId && message.conversationId ? { conversationId: message.conversationId } : {}),
    ...(message.conversationCreatedAt ? { createdAt: String(message.conversationCreatedAt) } : {}),
    ...(message.messageId ? { messageId: message.messageId } : {}),
    ...(message.scopeType ? { scopeType: message.scopeType } : {}),
    ...fcmLogFieldsFromMessage(message),
  };
}
