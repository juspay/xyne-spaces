import {
  queryCacheActor,
  type QueryCacheConversation,
  type ThreadConversation,
} from '@xyne/shared/machines';

import { containsChatWindowTarget } from './chatWindowContainment';

export type PersistedChatWindowTarget = {
  channelId: string;
  kind?: 'channel' | 'thread';
  threadId?: string;
  conversationId?: string;
  messageId?: string;
};

export type PersistedChatWindowReader = (
  kind: 'channel' | 'thread',
  id: string,
  targetMessageId?: string,
) => unknown | null;

export type PersistedChatWindowWriter = {
  setChannel: (channelId: string, conversations: QueryCacheConversation[]) => void;
  setThread: (conversationId: string, conversation: ThreadConversation) => void;
};

let persistedChatWindowReader: PersistedChatWindowReader | null = null;

export const registerPersistedChatWindowReader = (reader: PersistedChatWindowReader): void => {
  persistedChatWindowReader = reader;
};

const queryCacheWriter: PersistedChatWindowWriter = {
  setChannel: (channelId, conversations) => {
    queryCacheActor.send({
      type: 'SET_CONVERSATIONS',
      channelId,
      conversations,
    });
  },
  setThread: (conversationId, conversation) => {
    queryCacheActor.send({
      type: 'SET_THREAD_CONVERSATION',
      conversationId,
      conversation,
    });
  },
};

const getInMemoryChatWindow = (kind: 'channel' | 'thread', id: string): unknown => {
  const cache = queryCacheActor.getSnapshot().context;
  if (kind === 'thread') {
    return cache.threadConversations[id];
  }
  return cache.channelConversations[id];
};

const getRestoreCandidates = (
  target: PersistedChatWindowTarget,
): Array<{ kind: 'channel' | 'thread'; id: string }> => {
  const channelId = target.channelId.trim();
  const explicitThreadId = target.threadId?.trim();
  const conversationId = target.conversationId?.trim();
  const threadId = explicitThreadId || conversationId;

  if (target.kind === 'thread') {
    return threadId ? [{ kind: 'thread', id: threadId }] : [];
  }

  if (target.kind === 'channel') {
    return [{ kind: 'channel', id: channelId }];
  }

  if (explicitThreadId) return [{ kind: 'thread', id: explicitThreadId }];

  if (!conversationId) {
    return [{ kind: 'channel', id: channelId }];
  }

  // A conversation-only link is ambiguous until the resolver identifies its
  // destination. Notification warming stores thread windows under the same
  // conversation id, so prefer that exact entity and fall back to the parent
  // channel window for ordinary channel/DM messages.
  return [
    { kind: 'thread', id: conversationId },
    { kind: 'channel', id: channelId },
  ];
};

const getWindowRowCount = (kind: 'channel' | 'thread', value: unknown): number => {
  if (kind === 'channel') return Array.isArray(value) ? value.length : 0;
  if (!value || typeof value !== 'object' || !('messages' in value)) return 0;
  const messages = (value as { messages?: unknown }).messages;
  return Array.isArray(messages) ? messages.length : 0;
};

/**
 * Restore a previously persisted chat window before its open route mounts.
 *
 * In-memory data is authoritative only while it can actually land this open. A
 * window left over from an earlier visit predates the message the notification
 * points at, so treating "memory has rows" as sufficient made the freshly
 * warmed on-disk window unreachable on a warm resume — the surface then painted
 * from a partially materialized live query instead. Containment, not mere
 * existence, decides which source wins; a disk window may only supersede a
 * populated memory window when it holds the requested message.
 *
 * A partial window can still provide warm context; anchored chat surfaces keep
 * the target concealed until live data places it.
 */
export const restorePersistedChatWindow = (
  target: PersistedChatWindowTarget,
  reader: PersistedChatWindowReader | null = persistedChatWindowReader,
  writer: PersistedChatWindowWriter = queryCacheWriter,
): void => {
  const channelId = target.channelId.trim();
  if (!channelId || !reader) return;

  const messageId = target.messageId?.trim();
  const candidates = getRestoreCandidates(target);
  if (candidates.length === 0) return;

  for (const { kind, id } of candidates) {
    const inMemoryWindow = getInMemoryChatWindow(kind, id);
    const hasInMemoryRows = !!inMemoryWindow && getWindowRowCount(kind, inMemoryWindow) > 0;
    const inMemoryHasTarget = messageId
      ? containsChatWindowTarget(kind, inMemoryWindow, messageId)
      : false;
    // Without a requested message any populated window is equally usable, so
    // memory keeps its precedence and no disk read is needed.
    if (hasInMemoryRows && (!messageId || inMemoryHasTarget)) {
      return;
    }

    const cached = reader(kind, id, messageId);
    if (!cached) continue;

    // Never trade a populated window for a disk window that cannot land the
    // open either — that would discard warm context for no gain.
    if (hasInMemoryRows && messageId && !containsChatWindowTarget(kind, cached, messageId)) {
      continue;
    }

    if (kind === 'thread') {
      const conversation = cached as ThreadConversation;
      if (!Array.isArray(conversation.messages) || conversation.messages.length === 0) continue;

      writer.setThread(id, conversation);
      return;
    }

    const conversations = cached as QueryCacheConversation[];
    if (!Array.isArray(conversations) || conversations.length === 0) continue;

    writer.setChannel(id, conversations);
    return;
  }
};
