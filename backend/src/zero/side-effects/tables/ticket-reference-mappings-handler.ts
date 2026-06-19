import { ActivityClassification, TicketReferenceRelation } from '@prisma/client';
import { BaseSideEffectHandler } from '../base-handler';
import type { SideEffectJobConfig } from '../types';
import { db } from '@/database/client';
import { notificationService } from '@/services/notificationService';
import { logger } from '@/utils/logger';
import { getFormFieldUserActors } from '@/utils/ticketActorUtils';
import { activityService } from '@/services/activity/activityService';

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

function formatTicketReferenceRelationLabel(relationType: TicketReferenceRelation): string {
  switch (relationType) {
    case TicketReferenceRelation.DUPLICATE_CONFIRMED:
      return 'Duplicate';
    case TicketReferenceRelation.DUPLICATE_POSSIBLE:
      return 'Possible duplicate';
    case TicketReferenceRelation.MERGED_INTO:
      return 'Merged into';
    case TicketReferenceRelation.LINKED:
    default:
      return 'Linked';
  }
}

interface ReferenceMappingContext {
  sourceTicketId: string;
  targetTicketId: string;
  relationType: TicketReferenceRelation;
  ticket: { id: string; createdBy: string | null; assignedTo: string | null; channelId: string | null; conversationId: string | null };
  targetTicket: { title: string | null; xyneId: string | null } | null;
  actorId: string;
  activityRecipients: string[];
  allActorIds: string[];
}

async function resolveReferenceMappingContext(
  sourceTicketId: string,
  targetTicketId: string,
  relationType: TicketReferenceRelation,
  userId: string,
): Promise<ReferenceMappingContext | null> {
  const [ticket, targetTicket] = await Promise.all([
    db.ticket.findUnique({
      where: { id: sourceTicketId },
      select: { id: true, createdBy: true, assignedTo: true, channelId: true, conversationId: true },
    }),
    db.ticket.findUnique({
      where: { id: targetTicketId },
      select: { title: true, xyneId: true },
    }),
  ]);

  if (!ticket) {
    logger.warn(`[TicketReferenceMappingsHandler] Ticket ${sourceTicketId} not found`);
    return null;
  }

  const extraActors = await fetchTicketActors(sourceTicketId);

  const allActorIds = [
    ticket.createdBy,
    ticket.assignedTo,
    ...extraActors,
  ].filter((id, index, arr): id is string => Boolean(id) && arr.indexOf(id) === index);

  const actorId = userId;
  const activityRecipients = allActorIds.filter(id => id !== actorId);

  return { sourceTicketId, targetTicketId, relationType, ticket, targetTicket, actorId, activityRecipients, allActorIds };
}

export class TicketReferenceMappingsSideEffectHandler extends BaseSideEffectHandler {
  async onInsert(job: SideEffectJobConfig): Promise<void> {
    const { entityId: mappingId } = job;

    const mapping = await db.ticketReferenceMapping.findUnique({
      where: { id: mappingId },
      select: { sourceTicketId: true, targetTicketId: true, relationType: true },
    });

    if (!mapping) {
      logger.warn(`[TicketReferenceMappingsHandler] Mapping ${mappingId} not found`);
      return;
    }

    const ctx = await resolveReferenceMappingContext(
      mapping.sourceTicketId,
      mapping.targetTicketId,
      mapping.relationType,
      this.ctx.userID,
    );
    if (!ctx) return;

    const { sourceTicketId, targetTicketId, relationType, ticket, targetTicket, actorId, activityRecipients, allActorIds } = ctx;

    // Create activities for global activity feed
    if (activityRecipients.length > 0) {
      try {
        await Promise.all(
          activityRecipients.map(userId =>
            activityService.createActivity({
              userId,
              actorAction: 'ticket_reference_added',
              actionSource: 'ticket',
              actionSourceId: sourceTicketId,
              ticketId: sourceTicketId,
              channelId: ticket.channelId || undefined,
              actorId,
              classification: ActivityClassification.FYI,
            })
          )
        );
        logger.info(`[TicketReferenceMappingsHandler] Created activities for related ticket added for ticket ${sourceTicketId}`);
      } catch (error) {
        logger.error(`[TicketReferenceMappingsHandler] Failed to queue debounced activities for related ticket added:`, error);
      }
    }

    // Send notifications to all actors
    const relationLabel = formatTicketReferenceRelationLabel(relationType);
    const relatedTicketTitle = targetTicket?.title || targetTicket?.xyneId || targetTicketId;

    if (allActorIds.length > 0) {
      try {
        await notificationService.sendTicketRelatedTicketAddedNotification(
          sourceTicketId,
          allActorIds,
          relatedTicketTitle,
          relationLabel,
          actorId,
        );
        logger.info(`[TicketReferenceMappingsHandler] Sent related ticket added notification for ticket ${sourceTicketId}`);
      } catch (error) {
        logger.error(`[TicketReferenceMappingsHandler] Failed to send related ticket added notification:`, error);
      }
    }
  }

  async onDelete(job: SideEffectJobConfig): Promise<void> {
    const { entityId: mappingId, previousValue } = job;

    if (!previousValue) {
      logger.warn(`[TicketReferenceMappingsHandler] No previousValue for deleted mapping ${mappingId}`);
      return;
    }

    const { sourceTicketId, targetTicketId, relationType } = (previousValue as unknown) as Record<string, string>;

    if (!sourceTicketId || !targetTicketId) {
      logger.warn(`[TicketReferenceMappingsHandler] Missing sourceTicketId or targetTicketId in previousValue`);
      return;
    }

    const ctx = await resolveReferenceMappingContext(
      sourceTicketId,
      targetTicketId,
      relationType as TicketReferenceRelation,
      this.ctx.userID,
    );
    if (!ctx) return;

    const { sourceTicketId: sid, targetTicketId: tid, relationType: rt, ticket, targetTicket, actorId, activityRecipients, allActorIds } = ctx;

    // Create activities for global activity feed
    if (activityRecipients.length > 0) {
      try {
        await Promise.all(
          activityRecipients.map(userId =>
            activityService.createActivity({
              userId,
              actorAction: 'ticket_reference_removed',
              actionSource: 'ticket',
              actionSourceId: sid,
              ticketId: sid,
              channelId: ticket.channelId || undefined,
              actorId,
              classification: ActivityClassification.FYI,
            })
          )
        );
        logger.info(`[TicketReferenceMappingsHandler] Created activities for related ticket removed for ticket ${sid}`);
      } catch (error) {
        logger.error(`[TicketReferenceMappingsHandler] Failed to queue debounced activities for related ticket removed:`, error);
      }
    }

    // Send notifications to all actors
    const relationLabel = formatTicketReferenceRelationLabel(rt);
    const relatedTicketTitle = targetTicket?.title || targetTicket?.xyneId || tid;

    if (allActorIds.length > 0) {
      try {
        await notificationService.sendTicketRelatedTicketRemovedNotification(
          sid,
          allActorIds,
          relatedTicketTitle,
          relationLabel,
          actorId,
        );
        logger.info(`[TicketReferenceMappingsHandler] Sent related ticket removed notification for ticket ${sid}`);
      } catch (error) {
        logger.error(`[TicketReferenceMappingsHandler] Failed to send related ticket removed notification:`, error);
      }
    }
  }
}
