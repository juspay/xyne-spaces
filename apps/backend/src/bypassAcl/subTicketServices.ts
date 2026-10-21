import type { Prisma } from '@prisma/client';
import { rawQuery } from './base';

/**
 * Relocated from services/subTicketLinkService's assertNoCycle. The recursive CTE walks the
 * sub-ticket ancestor chain at arbitrary depth, which Prisma's query builder cannot express.
 * Returns true when linking `mappedTicketId` under `ticketId` would close a loop. SQL unchanged.
 */
export async function subTicketLinkClosesLoop(
  tx: Prisma.TransactionClient,
  ticketId: string,
  mappedTicketId: string,
): Promise<boolean> {
  const rows = await rawQuery(
    ['Ticket', 'SubTicket', 'TicketSubTicketMapping'],
    'sub-ticket link: recursive ancestor walk to reject a link that would close a cycle',
    () => tx.$queryRaw<Array<{ found: number }>>`
    WITH RECURSIVE ancestors AS (
      SELECT ${ticketId}::text AS ticket_id
      UNION
      SELECT m."ticketId"
      FROM ancestors a
      JOIN "public"."sub_tickets" s ON s."mappedTicketId" = a.ticket_id
      JOIN "public"."ticket_sub_ticket_mappings" m ON m."subTicketId" = s.id
    )
    SELECT 1 AS found FROM ancestors WHERE ticket_id = ${mappedTicketId} LIMIT 1
  `,
  );
  return rows.length > 0;
}
