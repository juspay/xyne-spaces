import { getJson, getString, lotusStorage, setJson } from '@/src/services/localStorage';

import type { MessageGroup, ParsedMessage, StoredMessage } from '../types';

const USER_ID_KEY = '@lotus_user_id';
const GLOBAL_USER_ID_KEY = 'xyne-global:userId';
const GROUP_PREFIX = '@notif_v3_group';
const MAX_STORED_MESSAGES = 25;

function resolveUserId(): string | null {
  return getString(USER_ID_KEY) ?? getString(GLOBAL_USER_ID_KEY);
}

function fullKey(userId: string, storeKey: string): string {
  return `${GROUP_PREFIX}:${userId}:${storeKey}`;
}

function toStoredMessage(message: ParsedMessage): StoredMessage {
  return {
    text: message.rawBody || message.body,
    timestamp: message.timestamp,
    person: {
      name: message.senderName || message.title,
      ...(message.senderPicture ? { icon: message.senderPicture } : {}),
    },
    ...(message.messageId ? { messageId: message.messageId } : {}),
    ...(message.senderId ? { senderId: message.senderId } : {}),
  };
}

export function appendMessageToGroup(message: ParsedMessage): MessageGroup | null {
  const userId = resolveUserId();
  if (!userId) {
    return null;
  }

  const key = fullKey(userId, message.storeKey);
  const group = getJson<MessageGroup>(key) ?? { title: '', messages: [] };
  const entry = toStoredMessage(message);

  if (entry.messageId && group.messages.some(m => m.messageId === entry.messageId)) {
    return group;
  }

  const messages = [...group.messages, entry];
  if (messages.length > MAX_STORED_MESSAGES) {
    messages.splice(0, messages.length - MAX_STORED_MESSAGES);
  }

  const next: MessageGroup = {
    title: group.title || message.title,
    messages,
    ...(group.scopeType || message.scopeType
      ? { scopeType: group.scopeType || message.scopeType }
      : {}),
  };

  setJson(key, next);
  return next;
}

export function appendLocalBubble(storeKey: string, bubble: StoredMessage): MessageGroup | null {
  const userId = resolveUserId();
  if (!userId) return null;

  const key = fullKey(userId, storeKey);
  const group = getJson<MessageGroup>(key) ?? { title: '', messages: [] };
  const messages = [...group.messages, bubble];
  if (messages.length > MAX_STORED_MESSAGES) {
    messages.splice(0, messages.length - MAX_STORED_MESSAGES);
  }
  const next: MessageGroup = { ...group, messages };
  setJson(key, next);
  return next;
}

export function getMessageGroup(storeKey: string): MessageGroup | null {
  const userId = resolveUserId();
  if (!userId) return null;
  const group = getJson<MessageGroup>(fullKey(userId, storeKey));
  if (!group || (group.messages.length === 0 && !group.title)) return null;
  return group;
}

export function updateMessageTextInGroup(
  storeKey: string,
  messageId: string,
  newText: string,
): MessageGroup | null {
  const userId = resolveUserId();
  if (!userId) return null;

  const key = fullKey(userId, storeKey);
  const group = getJson<MessageGroup>(key);
  if (!group) return null;

  let changed = false;
  const messages = group.messages.map(m => {
    if (m.messageId && m.messageId === messageId) {
      changed = true;
      return { ...m, text: newText };
    }
    return m;
  });
  if (!changed) return null;

  const next: MessageGroup = { ...group, messages };
  setJson(key, next);
  return next;
}

export function removeMessageFromGroup(storeKey: string, messageId: string): MessageGroup | null {
  const userId = resolveUserId();
  if (!userId) return null;

  const key = fullKey(userId, storeKey);
  const group = getJson<MessageGroup>(key);
  if (!group) return null;

  const messages = group.messages.filter(m => m.messageId !== messageId);
  if (messages.length === group.messages.length) return null;

  const next: MessageGroup = { ...group, messages };
  if (messages.length === 0) {
    lotusStorage.remove(key);
  } else {
    setJson(key, next);
  }
  return next;
}

export function clearMessageGroup(storeKey: string): void {
  const userId = resolveUserId();
  if (!userId) return;
  lotusStorage.remove(fullKey(userId, storeKey));
}

export function clearMessageGroupByNotificationId(notificationId: string): void {
  clearMessageGroup(`notif_channel_${notificationId}`);
  clearMessageGroup(`notif_thread_${notificationId}`);
}
