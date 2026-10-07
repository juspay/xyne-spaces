import { Prisma, type PrismaClient } from '@prisma/client';
import { rawQuery } from './base';

type TagClient = PrismaClient | Prisma.TransactionClient;

/**
 * Relocated from tagRepository's findConversationIdsByEmailTags. The (category, tag) OR-list is
 * built by the caller and passed in as a fragment; the rest of the statement is unchanged.
 */
export async function queryConversationIdsByEmailTags(client: TagClient, channelId: string, whereClause: Prisma.Sql): Promise<Array<{ conversationId: string }>> {
  return rawQuery(
    ['Email', 'Tag'],
    'desk tags: latest-email-per-conversation roll-up filtered by an OR-list of (category, tag) pairs',
    () => client.$queryRaw<{ conversationId: string }[]>`
      SELECT e."conversationId", MAX(e."createdAt") AS latest
      FROM public.emails e
      WHERE e."channelId" = ${channelId}
        AND EXISTS (
          SELECT 1 FROM non_zero.tags t
          WHERE t."sourceId" = e.id
            AND t."sourceType" = 'desk-email'
            AND t."isDeleted" = false
            AND (${whereClause})
        )
      GROUP BY e."conversationId"
      ORDER BY latest DESC
      LIMIT 1000
    `,
  );
}
