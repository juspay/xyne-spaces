import { BaseSideEffectHandler } from '../base-handler';
import { ActivityClassification } from '@xyne/shared';
import type { SideEffectJobConfig, TicketStageEtaPreviousValue } from '../types';
import { db } from '@/database/client';
import { activityService } from '@/services/activity/activityService';
import { syncStageOverdueFlag } from '@/services/tickets/syncStageOverdueFlag';
import { logger } from '@/utils/logger';

export class TicketStageEtaSideEffectHandler extends BaseSideEffectHandler {
  async onInsert(job: SideEffectJobConfig): Promise<void> {
    const ticketId = this.getTicketId(job);
    if (!ticketId) return;
    await syncStageOverdueFlag(db, ticketId);
  }

  async onUpdate(job: SideEffectJobConfig): Promise<void> {
    const { entityId: ticketStageEtaId, args, previousValue } = job;

    if (!previousValue) {
      logger.warn(`[TicketStageEtaSideEffectHandler] No previousValue for ticket_stage_eta ${ticketStageEtaId}`);
      return;
    }

    const prev = previousValue as TicketStageEtaPreviousValue;
    const actorId = this.ctx.userID;

    await syncStageOverdueFlag(db, prev.ticketId);

    // Only track stageEta changes
    const stageEtaChanged = args.stageEta !== undefined && args.stageEta !== prev.stageEta;

    if (!stageEtaChanged) {
      return;
    }

    try {
      // Fetch ticket details for activity creation
      const ticket = await db.ticket.findUnique({
        where: { id: prev.ticketId },
        select: {
          id: true,
          createdBy: true,
          assignedTo: true,
          channelId: true,
        },
      });

      if (!ticket) {
        logger.warn(`[TicketStageEtaSideEffectHandler] Ticket ${prev.ticketId} not found`);
        return;
      }
      // Notify creator and assignee (exclude actor)
      const usersToNotify = [ticket.createdBy, ticket.assignedTo]
        .filter((userId, index, arr): userId is string =>
          Boolean(userId) && userId !== actorId && arr.indexOf(userId) === index
        );

      if (usersToNotify.length === 0) {
        return;
      }

      // Create activities for each user
      for (const userId of usersToNotify) {
        await activityService.createActivity({
          userId,
          actorAction: 'ticket_stage_eta',
          actionSource: 'ticket',
          actionSourceId: ticket.id,
          ticketId: ticket.id,
          channelId: ticket.channelId || undefined,
          actorId,
          classification: ActivityClassification.ACTIONABLE,
        });
      }
    } catch (error) {
      logger.error(`[TicketStageEtaSideEffectHandler] Failed to create activities:`, error);
    }
  }

  async onDelete(job: SideEffectJobConfig): Promise<void> {
    const ticketId = this.getTicketId(job);
    if (!ticketId) return;
    await syncStageOverdueFlag(db, ticketId);
  }

  async onUpsert(job: SideEffectJobConfig): Promise<void> {
    const ticketId = this.getTicketId(job);
    if (!ticketId) return;
    await syncStageOverdueFlag(db, ticketId);
  }

  private getTicketId(job: SideEffectJobConfig): string | null {
    const previousValue = job.previousValue as TicketStageEtaPreviousValue | undefined;
    return job.args?.ticketId ?? previousValue?.ticketId ?? null;
  }
}
