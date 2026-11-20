import { transaction } from '../base';
import { db } from '@/database/client';
import { generateTicketId } from '@/bypassAcl/transactions/ticketIdService';
import { ActivityType, TicketStatusV2 } from '@xyne/shared';

export interface CreateChildTicketInput {
  parent: { id: string; workspaceId: string; conversationId: string; channelId: string };
  projectId: string;
  boardId: string;
  title: string;
  description: string;
  stageName?: string;
  priority?: string;
  assignedTo?: string;
  createdBy: string;
}

/** A ticket created as a sub-ticket: it lives in the parent's conversation, like release service tickets. */
export function createChildTicketTx(input: CreateChildTicketInput) {
  const { parent, projectId, boardId, title, description, stageName, priority, assignedTo, createdBy } = input;
  return transaction(
    ['Project', 'Stage', 'Ticket', 'SubTicket', 'TicketSubTicketMapping', 'TicketActivity'],
    'createTicketStep: the ticket, its sub-ticket row, the parent mapping and the activity plus id allocation must commit together; tx is not ACL-wrapped',
    db,
    async (tx) => {
      const stage = await tx.stage.findFirst({
        where: { boardId, ...(stageName ? { name: stageName } : {}) },
        orderBy: { sequenceNumber: 'asc' },
        select: { name: true, defaultTicketStatusV2: true },
      });
      if (stageName && !stage) throw new Error(`Stage "${stageName}" is not on board ${boardId}`);

      const xyneId = await generateTicketId(tx, projectId);
      const ticket = await tx.ticket.create({
        data: {
          title,
          description,
          createdBy,
          updatedBy: createdBy,
          conversationId: parent.conversationId,
          channelId: parent.channelId,
          xyneId,
          projectId,
          workspaceId: parent.workspaceId,
          boardId,
          statusV2: stage?.defaultTicketStatusV2 ?? TicketStatusV2.TODO,
          stageName: stage?.name ?? 'Backlog',
          ...(priority ? { priority } : {}),
          ...(assignedTo ? { assignedTo } : {}),
          lastEmailAt: new Date(),
        },
      });

      const subTicket = await tx.subTicket.create({
        data: {
          title,
          description,
          createdBy,
          updatedBy: createdBy,
          conversationId: parent.conversationId,
          mappedTicketId: ticket.id,
          assignedTo: assignedTo ?? null,
          workspaceId: parent.workspaceId,
        },
      });
      await tx.ticketSubTicketMapping.create({
        data: { ticketId: parent.id, subTicketId: subTicket.id, workspaceId: parent.workspaceId },
      });
      await tx.ticketActivity.create({
        data: {
          ticketId: parent.id,
          workspaceId: parent.workspaceId,
          updatedBy: createdBy,
          activityType: ActivityType.SUBTICKET_CREATED,
          value: { subTicketId: subTicket.id, subTicketTitle: title, ticketId: ticket.id, ticketXyneId: xyneId },
        },
      });

      return { ticketId: ticket.id, xyneId, subTicketId: subTicket.id };
    },
  );
}
