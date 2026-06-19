import { ActivityClassification } from '@prisma/client';
import { BaseSideEffectHandler } from '../base-handler';
import type { SideEffectJobConfig } from '../types';
import { db } from '@/database/client';
import { activityService } from '@/services/activity/activityService';
import { notificationService } from '@/services/notificationService';
import { logger } from '@/utils/logger';
import { getFormFieldUserActors } from '@/utils/ticketActorUtils';

async function fetchTicketActors(ticketId: string): Promise<string[]> {
  const [roleAssignments, formFieldUserActors] = await Promise.all([
    db.ticketAssignment.findMany({
      where: { ticketId },
      select: { userId: true },
    }),
    getFormFieldUserActors(ticketId),
  ]);

  return roleAssignments.map(a => a.userId).concat(formFieldUserActors);
}

export class TicketSubTicketMappingsSideEffectHandler extends BaseSideEffectHandler {
  async onInsert(job: SideEffectJobConfig): Promise<void> {
    const { entityId: mappingId } = job;

    const mapping = await db.ticketSubTicketMapping.findUnique({
      where: { id: mappingId },
      select: { ticketId: true, subTicketId: true },
    });

    if (!mapping) {
      logger.warn(`[TicketSubTicketMappingsHandler] Mapping ${mappingId} not found`);
      return;
    }

    const [ticket, subTicket] = await Promise.all([
      db.ticket.findUnique({
        where: { id: mapping.ticketId },
        select: { id: true, createdBy: true, assignedTo: true, channelId: true, conversationId: true },
      }),
      db.subTicket.findUnique({
        where: { id: mapping.subTicketId },
        select: { title: true },
      }),
    ]);

    if (!ticket) {
      logger.warn(`[TicketSubTicketMappingsHandler] Ticket ${mapping.ticketId} not found`);
      return;
    }

    const actorId = this.ctx.userID;
    const extraActors = await fetchTicketActors(mapping.ticketId);

    const allActorIds = [
      ticket.createdBy,
      ticket.assignedTo,
      ...extraActors,
    ].filter((id, index, arr): id is string => Boolean(id) && arr.indexOf(id) === index);

    const activityRecipients = allActorIds.filter(id => id !== actorId);

    if (activityRecipients.length > 0) {
      try {
        await Promise.all(
          activityRecipients.map(userId =>
            activityService.createActivity({
              userId,
              actorAction: 'ticket_subticket_added',
              actionSource: 'ticket',
              actionSourceId: mapping.ticketId,
              ticketId: mapping.ticketId,
              channelId: ticket.channelId || undefined,
              actorId,
              classification: ActivityClassification.FYI,
            })
          )
        );
        logger.info(`[TicketSubTicketMappingsHandler] Created activities for subticket added for ticket ${mapping.ticketId}`);
      } catch (error) {
        logger.error(`[TicketSubTicketMappingsHandler] Failed to queue debounced activities for subticket added:`, error);
      }
    }

    if (allActorIds.length > 0) {
      try {
        await notificationService.sendTicketSubticketAddedNotification(
          mapping.ticketId,
          allActorIds,
          subTicket?.title || 'Untitled Sub-ticket',
          actorId,
        );
        logger.info(`[TicketSubTicketMappingsHandler] Sent subticket added notification for ticket ${mapping.ticketId}`);
      } catch (error) {
        logger.error(`[TicketSubTicketMappingsHandler] Failed to send subticket added notification:`, error);
      }
    }
  }
}
