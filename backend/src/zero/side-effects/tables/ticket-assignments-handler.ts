import { ActivityClassification, UserResponsibility } from '@prisma/client';
import { BaseSideEffectHandler } from '../base-handler';
import type { SideEffectJobConfig } from '../types';
import { db } from '@/database/client';
import { activityService } from '@/services/activity/activityService';

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

    if (
      assignment.userResponsibility !== UserResponsibility.PR_REVIEWER &&
      assignment.userResponsibility !== UserResponsibility.QA
    ) {
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

    const actorAction =
      assignment.userResponsibility === UserResponsibility.PR_REVIEWER
        ? 'ticket_pr_reviewer_assigned'
        : 'ticket_qa_assigned';

      await activityService.createActivity({
        userId: assignment.userId,
        actorId: assignment.createdBy,
        actorAction,
        actionSource: 'ticket',
        actionSourceId: ticket.id,
        ticketId: ticket.id,
        channelId: ticket.channelId || undefined,
        classification: ActivityClassification.ACTIONABLE,
      });
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

    if (
      assignment.userResponsibility !== UserResponsibility.PR_REVIEWER &&
      assignment.userResponsibility !== UserResponsibility.QA
    ) {
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

    const actorAction =
      assignment.userResponsibility === UserResponsibility.PR_REVIEWER
        ? 'ticket_pr_reviewer_assigned'
        : 'ticket_qa_assigned';

      await activityService.createActivity({
        userId: assignment.userId,
        actorId: assignment.createdBy,
        actorAction,
        actionSource: 'ticket',
        actionSourceId: ticket.id,
        ticketId: ticket.id,
        channelId: ticket.channelId || undefined,
        classification: ActivityClassification.ACTIONABLE,
      });
  }
}