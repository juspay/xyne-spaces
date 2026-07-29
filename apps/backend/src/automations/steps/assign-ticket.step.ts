import { z } from 'zod';
import { BaseActionStep } from './base-step';
import { StepCategory } from '../types/categories';
import type { AutomationContext } from '../types/context';
import { variableRef } from '../engine/variable-ref';
import { repositories } from '@/database/repositories';
import { DatabaseClient } from '@/database/client';
import { ActivityType } from '@prisma/client';

const AssignTicketConfigSchema = z.object({
  ticketId: variableRef(z.string().min(1)),
  assigneeId: variableRef(z.string().min(1)),
});

const AssignTicketOutputSchema = z.object({
  ticketId: z.string(),
  assigneeId: z.string(),
});

interface AssignTicketOutput extends Record<string, unknown> {
  ticketId: string;
  assigneeId: string;
}

export class AssignTicketStep extends BaseActionStep<typeof AssignTicketConfigSchema, AssignTicketOutput> {
  readonly type = 'ASSIGN_TICKET';
  readonly configSchema = AssignTicketConfigSchema;
  readonly outputSchema = AssignTicketOutputSchema;
  readonly name = 'Assign a ticket';
  readonly description = 'Assigns the chosen ticket to a specific user.';
  readonly category = StepCategory.TICKET;
  readonly icon = 'UserPlus';

  async execute(
    config: z.infer<typeof AssignTicketConfigSchema>,
    context: AutomationContext,
  ): Promise<AssignTicketOutput> {
    const ticketId = config.ticketId as string;
    const assigneeId = config.assigneeId as string;
    const prisma = DatabaseClient.getInstance();

    const prev = await prisma.ticket.findUnique({ where: { id: ticketId }, select: { assignedTo: true } });
    await repositories.tickets.updateTicketAssignee(ticketId, assigneeId, context.automation.createdById);

    await prisma.ticketActivity.create({
      data: {
        ticketId,
        updatedBy: context.automation.createdById,
        workspaceId: context.automation.workspaceId,
        activityType: ActivityType.ASSIGNED_TO,
        value: { oldValue: prev?.assignedTo ?? null, newValue: assigneeId, isAutomation: true },
      },
    });

    return { ticketId, assigneeId };
  }
}

export const assignTicketStep = new AssignTicketStep();
