/**
 * Pure, dependency-free helpers for building and parsing message deep-links.
 *
 * Kept free of Zero/query imports so the copy-link contract can be unit-tested
 * in isolation and shared by both the producer (ChatBubble copy link) and the
 * consumer (ConversationPanelV2 hash parsing).
 */

export type MessageLinkContext = 'thread' | 'channel';

/**
 * Extract the origin conversation id from a deep-link hash.
 * Example: #origin=abc123&messageId=x -> abc123
 */
export const extractOriginFromHash = (hash: string): string | null => {
  if (!hash) return null;
  const match = hash.match(/origin=([^&]+)/);
  return match?.[1] ?? null;
};

/**
 * Extract the message id from a deep-link hash.
 * Example: #origin=abc&messageId=xyz789 -> xyz789
 */
export const extractMessageIdFromHash = (hash: string): string | null => {
  if (!hash) return null;
  const match = hash.match(/messageId=([^&]+)/);
  return match?.[1] ?? null;
};

/**
 * Extract the createdAt temporal anchor (epoch ms) from a deep-link hash.
 * Example: #origin=abc&createdAt=1712345678901 -> 1712345678901
 * Mirrors the receiver parsing in ConversationPanelV2 so the copy-link producer
 * and the link consumer stay in sync.
 */
export const extractCreatedAtFromHash = (hash: string): number | null => {
  if (!hash) return null;
  const match = hash.match(/createdAt=([^&#]+)/);
  if (!match?.[1]) return null;
  const parsed = parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Build a shareable deep link to a message.
 *
 * The `createdAt` temporal anchor is what lets the receiver load the message
 * window directly (getChannelConversationsSnapshot) instead of resolving the
 * target time through a Zero-cache ID lookup (getConversationByIdWithChannel),
 * which is slow or misses for OLDER messages that are not in the local cache —
 * the cause of links landing at the bottom of the channel instead of on the
 * linked message.
 */
export const buildMessageLink = (params: {
  shareableOrigin: string;
  channelId: string;
  conversationId: string;
  messageId: string;
  createdAt?: number | null;
  context: MessageLinkContext;
}): string => {
  const { shareableOrigin, channelId, conversationId, messageId, createdAt, context } = params;
  const createdAtParam =
    typeof createdAt === 'number' && Number.isFinite(createdAt) ? `&createdAt=${createdAt}` : '';

  if (context === 'thread') {
    // Thread message: full path with conversation + messageId + createdAt in hash.
    return `${shareableOrigin}/chat/dir/${channelId}/${conversationId}#origin=${conversationId}&messageId=${messageId}${createdAtParam}`;
  }
  // Channel message: channel in path, conversation + createdAt in hash.
  return `${shareableOrigin}/chat/dir/${channelId}#origin=${conversationId}${createdAtParam}`;
};
