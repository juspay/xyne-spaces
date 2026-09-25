import { transaction } from '../base';
import { db } from '@/database/client';
import { MirrorTagRow, tagRepository } from '@/database/repositories/tagRepository';
import { DESK_EMAIL_SOURCE_TYPE, deskEmailConfigKey } from '@/tags/deskEmail';
import { TagMethod } from '@xyne/shared';
import { DESK_TICKET_SOURCE_TYPE } from '@/tags/deskTicket';
import { advisoryXactLock } from '@/bypassAcl/lockServices';
export async function syncTicketTagsForConversationTx(conversationId: string, ticketId: string | null) {
  const result = await transaction(['Email', 'Tag', 'Ticket'], 'syncTicketTagsForConversation: ticket, email and tag mirror writes must commit atomically; tx is not ACL-wrapped', db, async (tx) => {
    await advisoryXactLock(tx, ['Ticket', 'Email', 'Tag'],
      'ticket tag mirror: serialize the compare-and-swap of a ticket\'s mirrored tag rows',
      'tag-mirror:' + conversationId);

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
  });
  return { result, ticketId };
}
