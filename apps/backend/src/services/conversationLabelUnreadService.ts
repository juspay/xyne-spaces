import { Prisma } from '@prisma/client';
import { db } from '@/database/client';

interface LabelUnreadRow {
  labelId: string;
  unreadCount: number;
}

/**
 * Unread predicate (mirrors TicketListRow.tsx): a ticket is unread for a user iff
 * emailCount > 0 AND (no email_reads row exists for (ticketId, userId)
 * OR email_reads.lastReadEmailAt < ticket.lastEmailAt).
 * Labels with zero unread are omitted from the map.
 */
export async function getLabelUnreadCounts(
  auth: { userId: string; workspaceId: string },
  channelId: string,
): Promise<Record<string, number>> {
  const rows = await db.$queryRaw<LabelUnreadRow[]>(Prisma.sql`
    SELECT m."labelId" AS "labelId", COUNT(*)::int AS "unreadCount"
    FROM "conversation_label_mappings" m
    JOIN "tickets" t ON t."conversationId" = m."conversationId"
    LEFT JOIN "email_reads" er
      ON er."ticketId" = t."id" AND er."userId" = ${auth.userId}
    WHERE m."channelId" = ${channelId}
      AND m."workspaceId" = ${auth.workspaceId}
      AND t."emailCount" > 0
      AND (er."lastReadEmailAt" IS NULL OR er."lastReadEmailAt" < t."lastEmailAt")
    GROUP BY m."labelId"
  `);

  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.labelId] = row.unreadCount;
  }
  return counts;
}
