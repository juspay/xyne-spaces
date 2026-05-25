import { z } from 'zod';
import { BaseActionStep } from './base-step';
import { StepCategory } from '../types/categories';
import type { AutomationContext } from '../types/context';
import { variableRef } from '../engine/variable-ref';
import { repositories } from '@/database/repositories';

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
    await repositories.tickets.updateTicketAssignee(
      config.ticketId as string,
      config.assigneeId as string,
      context.automation.createdById,
    );
    return {
      ticketId: config.ticketId as string,
      assigneeId: config.assigneeId as string,
    };
  }
}

export const assignTicketStep = new AssignTicketStep();
