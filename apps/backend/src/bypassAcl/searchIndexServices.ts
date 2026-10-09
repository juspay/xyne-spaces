import type { Prisma } from '@prisma/client';
import { rawQuery } from './base';

/**
 * Relocated from apps/core/conversationUtils's message delete path. `message_search` is a
 * search-index table with no Prisma model, so it can only be reached by raw SQL. Statement and
 * parameter unchanged.
 */
export function deleteMessageSearchRow(
  tx: Prisma.TransactionClient,
  messageId: string,
): Promise<number> {
  return rawQuery(
    ['Message'],
    'message delete: drop the message_search index row, which has no Prisma model',
    () => tx.$executeRawUnsafe('DELETE FROM message_search WHERE "messageId" = $1', messageId),
  );
}
