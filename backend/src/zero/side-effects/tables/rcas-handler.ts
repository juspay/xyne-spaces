import { ActivityClassification, ActivityType, MessageType } from '@prisma/client';
import { BaseSideEffectHandler } from '../base-handler';
import type { SideEffectJobConfig } from '../types';
import { db } from '@/database/client';
import { activityService } from '@/services/activity/activityService';
import { notificationService } from '@/services/notificationService';
import { logger } from '@/utils/logger';
import { getFormFieldUserActors } from '@/utils/ticketActorUtils';
import { v4 as uuidv4 } from 'uuid';

async function fetchTicketActors(ticketId: string): Promise<string[]> {
  const [roleAssignments, formFieldUserActors] = await Promise.all([
    db.ticketAssignment.findMany({
      where: { ticketId },
      select: { userId: true },
    }),
    getFormFieldUserActors(ticketId),
  ]);

  return roleAssignments.map(a => a.userId).filter((id): id is string => Boolean(id)).concat(formFieldUserActors);
}

interface RcaContext {
  rca: { ticketId: string; ownerId: string | null; title: string };
  ticket: { id: string; createdBy: string | null; assignedTo: string | null; conversationId: string | null; channelId: string | null; workspaceId: string; xyneId: string | null };
  actorId: string;
  activityRecipients: string[];
  allActorIds: string[];
}

async function resolveRcaContext(
  rcaId: string,
  userId: string,
  useOwnerAsActor: boolean
): Promise<RcaContext | null> {
  const rca = await db.rCA.findUnique({
    where: { id: rcaId },
    select: { ticketId: true, ownerId: true, title: true },
  });

  if (!rca) {
    logger.warn(`[RcasSideEffectHandler] RCA ${rcaId} not found`);
    return null;
  }

  const ticket = await db.ticket.findUnique({
    where: { id: rca.ticketId },
    select: { id: true, createdBy: true, assignedTo: true, conversationId: true, channelId: true, workspaceId: true, xyneId: true },
  });

  if (!ticket) {
    logger.warn(`[RcasSideEffectHandler] Ticket ${rca.ticketId} not found`);
    return null;
  }

  const actorId = useOwnerAsActor ? (rca.ownerId || userId) : userId;

  const extraActors = await fetchTicketActors(rca.ticketId);

  const allActorIds = [
    ticket.createdBy,
    ticket.assignedTo,
    ...extraActors,
  ].filter((id, index, arr): id is string => Boolean(id) && arr.indexOf(id) === index);

  const activityRecipients = allActorIds.filter(id => id !== actorId);

  return { rca, ticket, actorId, activityRecipients, allActorIds };
}

export class RcasSideEffectHandler extends BaseSideEffectHandler {
  async onInsert(job: SideEffectJobConfig): Promise<void> {
    const { entityId: rcaId } = job;

    const ctx = await resolveRcaContext(rcaId, this.ctx.userID, true);
    if (!ctx) return;

    const { rca, ticket, actorId, activityRecipients, allActorIds } = ctx;

    // Create ticket activities for timeline
    try {
      await db.ticketActivity.create({
        data: {
          id: uuidv4(),
          ticketId: rca.ticketId,
          updatedBy: actorId,
          timestamp: new Date(),
          activityType: ActivityType.RCA_CREATED,
          value: {
            rcaId,
            rcaTitle: rca.title,
          },
        },
      });
    } catch (error) {
      logger.error(`[RcasSideEffectHandler] Failed to create ticket activity for RCA creation:`, error);
    }

    // Create system message in conversation
    if (ticket.conversationId) {
      try {
        await db.message.create({
          data: {
            messageId: uuidv4(),
            conversationId: ticket.conversationId,
            senderId: actorId,
            content: `RCA created: ${rca.title}`,
            msgType: MessageType.SYSTEM,
            hasAttachment: false,
            edited: false,
            isDeleted: false,
            isSent: true,
            showInChannel: false,
            createdAt: new Date(),
            metadata: {
              activityType: ActivityType.RCA_CREATED,
              isTicketActivity: true,
            },
          },
        });
      } catch (error) {
        logger.error(`[RcasSideEffectHandler] Failed to create system message for RCA creation:`, error);
      }
    }

    // Create activities for global activity feed
    if (activityRecipients.length > 0) {
      try {
        await Promise.all(
          activityRecipients.map(userId =>
            activityService.createActivity({
              userId,
              actorAction: 'ticket_rca_created',
              actionSource: 'ticket',
              actionSourceId: rca.ticketId,
              ticketId: rca.ticketId,
              channelId: ticket.channelId || undefined,
              actorId,
              classification: ActivityClassification.FYI,
            })
          )
        );
        logger.info(`[RcasSideEffectHandler] Created activities for RCA creation for ticket ${rca.ticketId}`);
      } catch (error) {
        logger.error(`[RcasSideEffectHandler] Failed to create activities for RCA creation:`, error);
      }
    }

    // Send notifications to all actors
    if (allActorIds.length > 0) {
      try {
        await notificationService.sendTicketRcaCreatedNotification(
          rca.ticketId,
          allActorIds,
          actorId,
        );
        logger.info(`[RcasSideEffectHandler] Sent RCA created notification for ticket ${rca.ticketId}`);
      } catch (error) {
        logger.error(`[RcasSideEffectHandler] Failed to send RCA created notification:`, error);
      }
    }
  }

  async onUpdate(job: SideEffectJobConfig): Promise<void> {
    const { entityId: rcaId } = job;

    const ctx = await resolveRcaContext(rcaId, this.ctx.userID, false);
    if (!ctx) return;

    const { rca, ticket, actorId, activityRecipients, allActorIds } = ctx;

    // Create ticket activities for timeline
    try {
      await db.ticketActivity.create({
        data: {
          id: uuidv4(),
          ticketId: rca.ticketId,
          updatedBy: actorId,
          timestamp: new Date(),
          activityType: ActivityType.RCA_UPDATED,
          value: {
            rcaId,
            rcaTitle: rca.title,
          },
        },
      });
    } catch (error) {
      logger.error(`[RcasSideEffectHandler] Failed to create ticket activity for RCA update:`, error);
    }

    // Create system message in conversation
    if (ticket.conversationId) {
      try {
        await db.message.create({
          data: {
            messageId: uuidv4(),
            conversationId: ticket.conversationId,
            senderId: actorId,
            content: `RCA updated: ${rca.title}`,
            msgType: MessageType.SYSTEM,
            hasAttachment: false,
            edited: false,
            isDeleted: false,
            isSent: true,
            showInChannel: false,
            createdAt: new Date(),
            metadata: {
              activityType: ActivityType.RCA_UPDATED,
              isTicketActivity: true,
            },
          },
        });
      } catch (error) {
        logger.error(`[RcasSideEffectHandler] Failed to create system message for RCA update:`, error);
      }
    }

    // Create activities for global activity feed
    if (activityRecipients.length > 0) {
      try {
        await Promise.all(
          activityRecipients.map(userId =>
            activityService.createActivity({
              userId,
              actorAction: 'ticket_rca_updated',
              actionSource: 'ticket',
              actionSourceId: rca.ticketId,
              ticketId: rca.ticketId,
              channelId: ticket.channelId || undefined,
              actorId,
              classification: ActivityClassification.FYI,
            })
          )
        );
        logger.info(`[RcasSideEffectHandler] Created activities for RCA update for ticket ${rca.ticketId}`);
      } catch (error) {
        logger.error(`[RcasSideEffectHandler] Failed to create activities for RCA update:`, error);
      }
    }

    // Send notifications to all actors
    if (allActorIds.length > 0) {
      try {
        await notificationService.sendTicketRcaUpdatedNotification(
          rca.ticketId,
          allActorIds,
          actorId,
        );
        logger.info(`[RcasSideEffectHandler] Sent RCA updated notification for ticket ${rca.ticketId}`);
      } catch (error) {
        logger.error(`[RcasSideEffectHandler] Failed to send RCA updated notification:`, error);
      }
    }
  }
}
