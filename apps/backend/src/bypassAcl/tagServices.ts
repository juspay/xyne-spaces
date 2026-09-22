import { TagMethod } from '@xyne/shared';
import { tagRepository, MirrorTagRow } from '@/database/repositories/tagRepository';
import { DESK_EMAIL_SOURCE_TYPE, deskEmailConfigKey } from '@/tags/deskEmail';
import { transaction } from './base';

export const DESK_TICKET_SOURCE_TYPE = 'desk-ticket';

/**
 * Relocated from tags/deskTicket.ts's syncTicketTagsForConversation: the ticket mirror must be
 * serialized by an advisory lock and compare-and-swap the tag rows atomically against the
 * conversation's latest email, which a per-user-scoped client cannot wrap in one transaction.
 * Returns the id of the ticket whose mirror changed, or null when there is no ticket or
 * nothing changed.
 */
export async function syncTicketTagsForConversationTx(conversationId: string): Promise<string | null> {
  let ticketId: string | null = null;

  await transaction(
    ['Ticket', 'Email', 'Tag'],
    'ticket tag mirror: advisory-locked compare-and-swap of tag rows across the ticket and its latest email',
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'tag-mirror:' + conversationId}))`;

      const ticket = await tx.ticket.findFirst({
        where: { conversationId },
        select: { id: true, channelId: true, workspaceId: true },
      });
      if (!ticket) return;

      const latest = await tx.email.findFirst({
        where: { conversationId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true },
      });

      const sourceRows: MirrorTagRow[] = latest
        ? (await tx.tag.findMany({
            where: { sourceId: latest.id, sourceType: DESK_EMAIL_SOURCE_TYPE, isDeleted: false },
            select: { tagCategory: true, tag: true, method: true, reason: true },
          })).map(r => ({ ...r, method: r.method as TagMethod }))
        : [];

      const changed = await tagRepository.replaceAllTagsForSource(
        {
          sourceId: ticket.id,
          sourceType: DESK_TICKET_SOURCE_TYPE,
          workspaceId: ticket.workspaceId,
          configKey: deskEmailConfigKey(ticket.channelId),
          rows: sourceRows,
        },
        tx,
      );

      if (changed) ticketId = ticket.id;
    },
  );

  return ticketId;
}
