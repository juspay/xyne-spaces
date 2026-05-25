import { z } from 'zod';
import { BaseActionStep } from './base-step';
import { StepCategory } from '../types/categories';
import type { AutomationContext } from '../types/context';
import { variableRef } from '../engine/variable-ref';
import { repositories } from '@/database/repositories';

const AssignTicketToGroupConfigSchema = z.object({
  ticketId: variableRef(z.string().min(1)),
  groupId: variableRef(z.string().min(1)),
});

const AssignTicketToGroupOutputSchema = z.object({
  ticketId: z.string(),
  groupId: z.string(),
});

interface AssignTicketToGroupOutput extends Record<string, unknown> {
  ticketId: string;
  groupId: string;
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
    await repositories.tickets.assignUserGroupToTicket(
      ticketId,
      groupId,
      context.automation.createdById,
    );
    return { ticketId, groupId };
  }
}

export const assignTicketToGroupStep = new AssignTicketToGroupStep();
