import type { Transaction } from '@rocicorp/zero';
import { BookmarkEntityType, type Schema } from './schema.js';
import { zql } from './builder.js';

/**
 * Resolve the channel a bookmarked entity belongs to, for the channel-scoped
 * Bookmarks tab. Only MESSAGE bookmarks carry a channel; thread replies resolve to
 * their parent channel because the thread conversation row stores channelId.
 * Returns null when the entity is not a message or cannot be resolved.
 */
export const resolveBookmarkChannelId = async (
  tx: Transaction<Schema>,
  entityId: string,
  entityType: BookmarkEntityType,
): Promise<string | null> => {
  if (entityType !== BookmarkEntityType.MESSAGE) {
    return null;
  }
  const message = await tx.run(
    zql.messages.where('messageId', entityId).related('conversation').one(),
  );
  return message?.conversation?.channelId ?? null;
};
