import { z } from 'zod';
import { BaseActionStep } from './base-step';
import { StepCategory } from '../types/categories';
import type { AutomationContext } from '../types/context';
import { variableRef } from '../engine/variable-ref';
import { repositories } from '@/database/repositories';
import { TicketStatusV2 } from '@prisma/client';

const CloseTicketConfigSchema = z.object({
  ticketId: variableRef(z.string().min(1)),
});

const CloseTicketOutputSchema = z.object({
  ticketId: z.string(),
  closedAt: z.coerce.date(),
});

interface CloseTicketOutput extends Record<string, unknown> {
  ticketId: string;
  closedAt: Date;
}

export class CloseTicketStep extends BaseActionStep<typeof CloseTicketConfigSchema, CloseTicketOutput> {
  readonly type = 'CLOSE_TICKET';
  readonly configSchema = CloseTicketConfigSchema;
  readonly outputSchema = CloseTicketOutputSchema;
  readonly name = 'Close a ticket';
  readonly description = 'Marks the chosen ticket as completed and stamps when / by whom.';
  readonly category = StepCategory.TICKET;
  readonly icon = 'CircleCheck';

  async execute(
    config: z.infer<typeof CloseTicketConfigSchema>,
    context: AutomationContext,
  ): Promise<CloseTicketOutput> {
    const ticketId = config.ticketId as string;
    const updatedBy = context.automation.createdById;
    const closedAt = new Date();
    await repositories.tickets.updateTicketFields(
      ticketId,
      { statusV2: TicketStatusV2.COMPLETED, closedAt, closedBy: updatedBy },
      updatedBy,
    );
    return { ticketId, closedAt };
  }
}

export const closeTicketStep = new CloseTicketStep();
