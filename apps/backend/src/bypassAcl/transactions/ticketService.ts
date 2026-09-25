import { transaction } from '../base';
import { prisma } from '@/services/ticketService';
import { dualDeleteTicketTag, dualWriteTicketTags } from '@/services/ticketTagDualWriteService';


export function updateTicketTagsTx(toRemove: string[], ticketId: string, toAdd: string[], ticket: any) {
  return transaction(['ProjectTag', 'Ticket', 'TicketTag', 'TicketTagMapping'], 'updateTicketTags: ticket tag removals plus additions with dual-write rows must commit atomically; tx is not ACL-wrapped', prisma, async tx => {
    if (toRemove.length > 0) {
      await tx.ticketTag.deleteMany({
        where: { ticketId, name: { in: toRemove } },
      });
      for (const name of toRemove) {
        await dualDeleteTicketTag(ticketId, name, tx);
      }
    }
    if (toAdd.length > 0) {
      await tx.ticketTag.createMany({
        data: toAdd.map(name => ({ name, ticketId, workspaceId: ticket.workspaceId })),
      });
      await dualWriteTicketTags(ticketId, toAdd, tx);
    }
  });
}
export function bulkUpdateTicketTagsTx(toRemove: string[], ticketId: string, toAdd: string[], workspaceId: string) {
  return transaction(['ProjectTag', 'Ticket', 'TicketTag', 'TicketTagMapping'], 'bulkUpdateTicketTags: ticket tag removals plus additions with dual-write rows must commit atomically; tx is not ACL-wrapped', prisma, async tx => {
    if (toRemove.length > 0) {
      await tx.ticketTag.deleteMany({
        where: { ticketId, name: { in: toRemove } },
      });
      for (const name of toRemove) {
        await dualDeleteTicketTag(ticketId, name, tx);
      }
    }
    if (toAdd.length > 0) {
      await tx.ticketTag.createMany({
        data: toAdd.map(name => ({ name, ticketId, workspaceId })),
      });
      await dualWriteTicketTags(ticketId, toAdd, tx);
    }
  });
}
