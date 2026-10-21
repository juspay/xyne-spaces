import type { ChatCacheEntityKind } from '@/src/services/chatCacheTypes';

/**
 * Whether a cached chat window already holds the exact message a notification
 * points at.
 *
 * This is the single containment rule shared by every consumer — warm-up skip
 * checks, persisted-source selection, and the storage reader's source
 * preference. It lives in its own leaf module so the storage adapter and the
 * navigation restore path can both depend on it without a cycle, and so the
 * rule can never drift between them.
 */
export const containsChatWindowTarget = (
  kind: ChatCacheEntityKind,
  value: unknown,
  messageId: string,
): boolean => {
  if (kind === 'channel') {
    return (
      Array.isArray(value) &&
      value.some(
        row =>
          row &&
          typeof row === 'object' &&
          (row as { initialMessageId?: unknown }).initialMessageId === messageId,
      )
    );
  }

  if (!value || typeof value !== 'object') return false;
  const messages = (value as { messages?: unknown }).messages;
  return (
    Array.isArray(messages) &&
    messages.some(
      row =>
        row && typeof row === 'object' && (row as { messageId?: unknown }).messageId === messageId,
    )
  );
};
