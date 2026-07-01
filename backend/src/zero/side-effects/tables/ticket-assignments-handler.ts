import { ActivityClassification } from '@prisma/client';
import { BaseSideEffectHandler } from '../base-handler';
import type { SideEffectJobConfig } from '../types';
import { db } from '@/database/client';
import { activityService } from '@/services/activity/activityService';
import { notificationService } from '@/services/notificationService';
import { logger } from '@/utils/logger';

const LEGACY_ACTION_BY_ENUM: Record<string, string> = {
  MANAGER: 'ticket_manager_assigned',
  TEAM_LEAD: 'ticket_team_lead_assigned',
  MEMBER: 'ticket_assigned',
  PR_REVIEWER: 'ticket_pr_reviewer_assigned',
  QA: 'ticket_qa_assigned',
};

function buildRoleAssignedAction(roleName: string): string {
  const legacyAction = LEGACY_ACTION_BY_ENUM[roleName];
  if (legacyAction) return legacyAction;
  return `ticket_${roleName.toLowerCase()}_assigned`;
}

export class TicketAssignmentsSideEffectHandler extends BaseSideEffectHandler {
  private async processAssignment(assignmentId: string): Promise<void> {
    const assignment = await db.ticketAssignment.findUnique({
      where: { id: assignmentId },
      select: {
        ticketId: true,
        userId: true,
        roleId: true,
        createdBy: true,
      },
    });

    if (!assignment) {
      return;
    }

    if (assignment.createdBy === assignment.userId) {
      return;
    }

    if (!assignment.roleId || !assignment.userId) {
      return;
    }

    const role = await db.role.findUnique({
      where: { id: assignment.roleId },
      select: { name: true },
    });

    if (!role) {
      logger.warn(`[TicketAssignmentsHandler] Role ${assignment.roleId} not found for assignment ${assignmentId}`);
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

    const actorId = assignment.createdBy || this.ctx.userID;
    const actorAction = buildRoleAssignedAction(role.name);

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
      logger.error(`[TicketAssignmentsHandler] Failed to send notification for role ${role.name}:`, error);
    }
  }

  async onInsert(job: SideEffectJobConfig): Promise<void> {
    await this.processAssignment(job.entityId);
  }

  async onUpdate(job: SideEffectJobConfig): Promise<void> {
    await this.processAssignment(job.entityId);
  }
}
