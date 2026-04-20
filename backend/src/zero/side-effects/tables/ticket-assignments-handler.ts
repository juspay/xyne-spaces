import { ActivityClassification, UserResponsibility } from '@prisma/client';
import { BaseSideEffectHandler } from '../base-handler';
import type { SideEffectJobConfig } from '../types';
import { db } from '@/database/client';
import { activityService } from '@/services/activity/activityService';
import { notificationService } from '@/services/notificationService';
import { logger } from '@/utils/logger';

const ROLE_ACTION_MAP: Record<UserResponsibility, string> = {
  [UserResponsibility.MANAGER]: 'ticket_manager_assigned',
  [UserResponsibility.TEAM_LEAD]: 'ticket_team_lead_assigned',
  [UserResponsibility.MEMBER]: 'ticket_assigned',
  [UserResponsibility.PR_REVIEWER]: 'ticket_pr_reviewer_assigned',
  [UserResponsibility.QA]: 'ticket_qa_assigned',
};

export class TicketAssignmentsSideEffectHandler extends BaseSideEffectHandler {
  async onInsert(job: SideEffectJobConfig): Promise<void> {
    const { entityId: assignmentId } = job;

    const assignment = await db.ticketAssignment.findUnique({
      where: { id: assignmentId },
      select: {
        ticketId: true,
        userId: true,
        userResponsibility: true,
        createdBy: true,
      },
    });

    if (!assignment) {
      return;
    }

    if (assignment.createdBy === assignment.userId) {
      return;
    }

    const ticket = await db.ticket.findUnique({
      where: { id: assignment.ticketId },
      select: {
        id: true,
        xyneId: true,
        channelId: true,
      },
    });

    if (!ticket) {
      return;
    }

    const actorAction = ROLE_ACTION_MAP[assignment.userResponsibility];
    const actorId = assignment.createdBy || this.ctx.userID;

    await activityService.createActivity({
      userId: assignment.userId,
      actorId,
      actorAction,
      actionSource: 'ticket',
      actionSourceId: ticket.id,
      ticketId: ticket.id,
      channelId: ticket.channelId || undefined,
      classification: ActivityClassification.ACTIONABLE,
    });

    try {
      await notificationService.sendTicketAssignmentNotification(
        ticket.id,
        assignment.userId,
        actorId,
      );
    } catch (error) {
      logger.error(`[TicketAssignmentsHandler] Failed to send notification for ${assignment.userResponsibility}:`, error);
    }
  }

  async onUpdate(job: SideEffectJobConfig): Promise<void> {
    const { entityId: assignmentId } = job;

    const assignment = await db.ticketAssignment.findUnique({
      where: { id: assignmentId },
      select: {
        ticketId: true,
        userId: true,
        userResponsibility: true,
        createdBy: true,
      },
    });

    if (!assignment) {
      return;
    }

    if (assignment.createdBy === assignment.userId) {
      return;
    }

    const ticket = await db.ticket.findUnique({
      where: { id: assignment.ticketId },
      select: {
        id: true,
        xyneId: true,
        channelId: true,
      },
    });

    if (!ticket) {
      return;
    }

    const actorAction = ROLE_ACTION_MAP[assignment.userResponsibility];
    const actorId = assignment.createdBy || this.ctx.userID;

    await activityService.createActivity({
      userId: assignment.userId,
      actorId,
      actorAction,
      actionSource: 'ticket',
      actionSourceId: ticket.id,
      ticketId: ticket.id,
      channelId: ticket.channelId || undefined,
      classification: ActivityClassification.ACTIONABLE,
    });

    try {
      await notificationService.sendTicketAssignmentNotification(
        ticket.id,
        assignment.userId,
        actorId,
      );
    } catch (error) {
      logger.error(`[TicketAssignmentsHandler] Failed to send notification for ${assignment.userResponsibility}:`, error);
    }
  }
}