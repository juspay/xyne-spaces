import { transaction } from '../base';
import { TicketRepository } from '@/database/repositories/ticketRepository';
import { pushVespaJobForTicket } from '@/apps/core/ticketutils';
import { FormFieldChanges } from '@/automations/triggers/ticket-updated.trigger';
import { logger } from '@/utils/logger';
import { TicketPriority, serializeTicketMd, type TicketCardSummary, FormEntityType } from '@xyne/shared';
import { PrismaClient } from '@prisma/client';
import { generateTicketId } from '@/bypassAcl/transactions/ticketIdService';


export function createTicketWithConversationTx(prisma: PrismaClient, projectId: string, ticketRepository: TicketRepository, title: string, description: string, userId: string, assignedTo: string | undefined, userGroupId: string | undefined, finalConversationId: string, channelId: string, workspaceId: string, boardId: string, priority: TicketPriority | undefined, stageName: string | undefined, eta: Date | undefined, ticketType: string | undefined, merchantId: string | undefined, formFieldChanges: FormFieldChanges | undefined, customFieldValues: { formId: string; contextId: string; fieldValues: { fieldId: string; fieldValue: string; fieldName?: string | undefined; actualFieldValue?: any; }[]; } | undefined) {
  return transaction(['Board', 'Conversation', 'FormEntityValues', 'Merchant', 'Project', 'Stage', 'StageTransition', 'Ticket', 'TicketActivity', 'TicketDescription', 'TicketStageEta', 'TicketTag'], 'createTicketWithConversation: ticket creation with sequence allocation, conversation link, and custom fields must commit atomically; tx is not ACL-wrapped', prisma, async (tx) => {
    // Generate xyneId using project-scoped format
    const xyneId = await generateTicketId(tx, projectId);
    // Create ticket using repository
    const createdTicket = await ticketRepository.createTicket({
      title,
      description,
      createdBy: userId,
      updatedBy: userId,
      assignedTo,
      userGroupId,
      conversationId: finalConversationId,
      channelId,
      projectId,
      workspaceId,
      boardId,
      priority: priority || TicketPriority.LOW,
      xyneId,
      stageName,
      eta,
      ticketType,
      merchantId,
      formFieldChanges,
    }, tx);

    pushVespaJobForTicket(createdTicket.id, userId, workspaceId || undefined).catch(error => {
      logger.error(`[CREATE-TICKET] Error pushing Vespa job for ticket ${createdTicket.id}:`, error);
    });

     const ticketMd = serializeTicketMd({
       id: createdTicket.id,
       title: createdTicket.title,
       description: createdTicket.description,
       statusV2: createdTicket.statusV2 as TicketCardSummary['statusV2'],
       priority: createdTicket.priority as TicketCardSummary['priority'],
       assignedTo: createdTicket.assignedTo ?? null,
       createdBy: createdTicket.createdBy,
       createdAt: createdTicket.createdAt.getTime(),
       eta: createdTicket.eta ? createdTicket.eta.getTime() : null,
       xyneId: createdTicket.xyneId,
       stageName: createdTicket.stageName,
       ticketType: createdTicket.ticketType ?? null,
       channelId: createdTicket.channelId,
       conversationId: createdTicket.conversationId,
     });

     // Update conversation with ticketId and ticket_md
     await tx.conversation.update({
       where: { conversationId: finalConversationId },
       data: { ticketId: createdTicket.id, ticket_md: ticketMd },
     });

    if (customFieldValues && customFieldValues.fieldValues.length > 0) {
      await tx.formEntityValues.createMany({
        data: customFieldValues.fieldValues.map(fieldValue => ({
          formId: customFieldValues.formId,
          entityId: createdTicket.id,
          entityType: FormEntityType.TICKET,
          fieldId: fieldValue.fieldId,
          contextId: customFieldValues.contextId,
          fieldValue: fieldValue.fieldValue,
          actualFieldValue: fieldValue.actualFieldValue,
          workspaceId,
        })),
      });
    }

    return createdTicket;
  });
}
