import { EmailType } from '@prisma/client';
import { logger } from '@/utils/logger';
import { repositories } from '@/database/repositories';
import { decodeCursor, paginateResults } from './paginationUtils';
import { EmailRepliesCursor, EmailRepliesItem, EmailRepliesResponse } from '../types';

/**
 * Get all emails in a conversation thread with cursor-based pagination
 *
 * @param channelId - Channel ID (required for validation)
 * @param conversationId - Conversation ID to fetch emails for (required)
 * @param limit - Maximum number of items to return (optional, default: 1000, max: 1000)
 * @param cursor - Base64 encoded cursor for pagination (optional)
 * @returns Email replies response with items, next cursor, and hasMore flag
 */
export async function getEmailReplies(
  channelId: string,
  conversationId: string,
  limit?: number,
  cursor?: string
): Promise<EmailRepliesResponse> {
  try {
    const conversation = await repositories.conversations.findById(conversationId);
    if (!conversation) {
      throw new Error('Conversation not found');
    }
    if (conversation.channelId !== channelId) {
      throw new Error('Conversation does not belong to the specified channel');
    }

    const actualLimit = Math.min(limit || 1000, 1000);
    const decodedCursor = decodeCursor<EmailRepliesCursor>(cursor);

    const emails = await repositories.emails.findManyWithCursor(
      conversationId,
      actualLimit + 1,
      decodedCursor
    );

    // Resolve parent (root DEFAULT email) per externalThreadId in one query
    const rootByThread = new Map<string, string>();
    const replyThreadIds = Array.from(
      new Set(emails.filter(e => e.type !== EmailType.DEFAULT).map(e => e.externalThreadId))
    );
    const roots = await repositories.emails.findRootsByExternalThreadIds(replyThreadIds);
    for (const r of roots) {
      if (!rootByThread.has(r.externalThreadId)) {
        rootByThread.set(r.externalThreadId, r.id);
      }
    }

    const itemsResults: EmailRepliesItem[] = emails.map((email) => ({
      id: email.id,
      parentId:
        email.type === EmailType.DEFAULT
          ? email.id
          : (rootByThread.get(email.externalThreadId) ?? email.id),
      type: email.type,
      subject: email.subject,
      content: email.body,
      to: email.to,
      from: email.from,
      cc: email.cc,
      bcc: email.bcc,
      createdAt: email.createdAt,
    }));

    const paginationResult = paginateResults(
      itemsResults,
      actualLimit,
      (item): EmailRepliesCursor => ({
        id: item.id,
        createdAt: item.createdAt.getTime(),
      })
    );

    return {
      items: paginationResult.items,
      nextCursor: paginationResult.nextCursor,
      hasMore: paginationResult.hasMore,
    };
  } catch (error) {
    logger.error('[EMAIL-REPLIES] Error fetching email replies:', error);
    throw error;
  }
}
