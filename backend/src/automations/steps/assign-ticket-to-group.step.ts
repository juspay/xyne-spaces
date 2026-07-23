import { z } from 'zod';
import { BaseActionStep } from './base-step';
import { StepCategory } from '../types/categories';
import type { AutomationContext } from '../types/context';
import { variableRef } from '../engine/variable-ref';
import { ticketAssignmentService } from '@/services/ticketAssignmentService';
import { DatabaseClient } from '@/database/client';
import { ActivityType } from '@prisma/client';

const AssignTicketToGroupConfigSchema = z.object({
  ticketId: variableRef(z.string().min(1)),
  groupId: variableRef(z.string().min(1)),
});

const AssignTicketToGroupOutputSchema = z.object({
  ticketId: z.string(),
  groupId: z.string(),
  assignedUserId: z.string().nullable(),
});

interface AssignTicketToGroupOutput extends Record<string, unknown> {
  ticketId: string;
  groupId: string;
  assignedUserId: string | null;
}

export class AssignTicketToGroupStep extends BaseActionStep<
  typeof AssignTicketToGroupConfigSchema,
  AssignTicketToGroupOutput
> {
  readonly type = 'ASSIGN_TICKET_TO_GROUP';
  readonly configSchema = AssignTicketToGroupConfigSchema;
  readonly outputSchema = AssignTicketToGroupOutputSchema;
  readonly name = 'Assign ticket to a group';
  readonly description = 'Sets the owning user group on a ticket (e.g. "Developer Support").';
  readonly category = StepCategory.TICKET;
  readonly icon = 'Users';

  async execute(
    config: z.infer<typeof AssignTicketToGroupConfigSchema>,
    context: AutomationContext,
  ): Promise<AssignTicketToGroupOutput> {
    const ticketId = config.ticketId as string;
    const groupId = config.groupId as string;
    const prisma = DatabaseClient.getInstance();

    const prev = await prisma.ticket.findUnique({ where: { id: ticketId }, select: { userGroupId: true } });
    const assignedUserId = await ticketAssignmentService.assignTicketToGroup({
      ticketId,
      groupId,
      actorId: context.automation.createdById,
    });

    await prisma.ticketActivity.create({
      data: {
        ticketId,
        updatedBy: context.automation.createdById,
        workspaceId: context.automation.workspaceId,
        activityType: ActivityType.USER_GROUP_ID,
        value: { field: 'userGroupId', oldValue: prev?.userGroupId ?? null, newValue: groupId, isAutomation: true },
      },
    });

    return { ticketId, groupId, assignedUserId: assignedUserId ?? null };
  }
}

export const assignTicketToGroupStep = new AssignTicketToGroupStep();
