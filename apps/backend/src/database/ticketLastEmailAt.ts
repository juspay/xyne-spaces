import { Prisma } from '@prisma/client';
import { withWorkspaceScope } from '@/database/tenant/context';

/**
 * THE ONLY WAY to change tickets.lastEmailAt after the ticket is created.
 *
 * Writes the ticket and flags every member's read row whose lastReadEmailAt is now
 * older (email_reads.hasNewEmail, read by the desk label unread counts) in one call,
 * so the flag can't drift from the timestamp. The emailRead.markAsRead /
 * bulkMarkAsRead Zero mutators clear it again.
 *
 * Callers keep their own "should this move?" checks — some deliberately set an
 * earlier value (e.g. a freshly ingested thread), so this does not force forward-only.
 * Ticket creates set lastEmailAt directly: no read rows exist yet.
 *
 * Pass a transaction client to make both writes atomic.
 */
export async function advanceLastEmailAt(
  client: Prisma.TransactionClient,
  target: { ticketId: string } | { conversationId: string },
  lastEmailAt: Date,
): Promise<void> {
  const ticketWhere: Prisma.TicketWhereInput =
    'ticketId' in target ? { id: target.ticketId } : { conversationId: target.conversationId };

  await client.ticket.updateMany({ where: ticketWhere, data: { lastEmailAt } });

  // Workspace scope: the email_reads ACL limits writes to the caller's own row, but a
  // new email makes the ticket unread for every member who had read it.
  await withWorkspaceScope(async () => {
    await client.emailRead.updateMany({
      // hasNewEmail is nullable (no DB default): flag both computed-false and NULL rows.
      where: {
        ticket: ticketWhere,
        lastReadEmailAt: { lt: lastEmailAt },
        OR: [{ hasNewEmail: false }, { hasNewEmail: null }],
      },
      data: { hasNewEmail: true },
    });
  });
}
