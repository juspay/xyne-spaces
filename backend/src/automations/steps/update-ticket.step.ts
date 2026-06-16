import { z } from 'zod';
import { BaseActionStep } from './base-step';
import { StepCategory } from '../types/categories';
import type { AutomationContext } from '../types/context';
import { variableRef } from '../engine/variable-ref';
import { repositories } from '@/database/repositories';
import { TicketStatusV2, TicketPriority, BoardType } from '@prisma/client';
import { DatabaseClient } from '@/database/client';
import { ticketStageTransitionService } from '@/services/stageTransition/ticketStageTransitionService';

const UpdateTicketConfigSchema = z.object({
  ticketId: variableRef(z.string().min(1)),
  title: variableRef(z.string()).optional(),
  description: variableRef(z.string()).optional(),
  priority: z.nativeEnum(TicketPriority).optional(),
  status: z.nativeEnum(TicketStatusV2).optional(),
  stageName: variableRef(z.string()).optional(),
  assignedTo: variableRef(z.string()).optional(),
});

const UpdateTicketOutputSchema = z.object({
  ticketId: z.string(),
});

interface UpdateTicketOutput extends Record<string, unknown> {
  ticketId: string;
}

export class UpdateTicketStep extends BaseActionStep<typeof UpdateTicketConfigSchema, UpdateTicketOutput> {
  readonly type = 'UPDATE_TICKET';
  readonly configSchema = UpdateTicketConfigSchema;
  readonly outputSchema = UpdateTicketOutputSchema;
  readonly name = 'Update a ticket';
  readonly description = 'Updates fields on an existing ticket — title, description, priority, status, stage, or assignee.';
  readonly category = StepCategory.TICKET;
  readonly icon = 'Pencil';

  async execute(
    config: z.infer<typeof UpdateTicketConfigSchema>,
    context: AutomationContext,
  ): Promise<UpdateTicketOutput> {
    const ticketId = config.ticketId as string;
    const updatedBy = context.automation.createdById;

    if (config.assignedTo !== undefined) {
      await repositories.tickets.updateTicketAssignee(ticketId, config.assignedTo as string, updatedBy);
    }

    if (config.stageName !== undefined) {
      const prisma = DatabaseClient.getInstance();
      const ticket = await prisma.ticket.findUnique({
        where: { id: ticketId },
        select: { board: { select: { boardType: true } } },
      });

      if (ticket?.board?.boardType === BoardType.NON_LINEAR) {
        const result = await ticketStageTransitionService.transitionTicket(
          ticketId,
          updatedBy,
          config.stageName as string,
          { isAutomation: true },
        );
        if (!result.success) {
          throw new Error(result.message ?? 'Stage transition failed');
        }
      } else {
        await repositories.tickets.updateTicketStage(ticketId, config.stageName as string, updatedBy);
      }
    }

    const fields: Parameters<typeof repositories.tickets.updateTicketFields>[1] = {};
    if (config.title !== undefined) fields.title = config.title as string;
    if (config.description !== undefined) fields.description = config.description as string;
    if (config.priority !== undefined) fields.priority = config.priority;
    if (config.status !== undefined) fields.statusV2 = config.status;

    if (Object.keys(fields).length > 0) {
      await repositories.tickets.updateTicketFields(ticketId, fields, updatedBy);
    }

    return { ticketId };
  }
}

export const updateTicketStep = new UpdateTicketStep();
