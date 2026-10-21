import { z } from 'zod';
import { BaseActionStep } from './base-step';
import { StepCategory } from '../types/categories';
import type { AutomationContext } from '../types/context';
import { variableRef } from '../engine/variable-ref';
import { db } from '@/database/client';
import { createSubTicket } from '@/services/subTicketService';
import { logger } from '@/utils/logger';

const LinkSubTicketConfigSchema = z.object({
  parentTicketId: variableRef(z.string().min(1)),
  mappedTicketId: variableRef(z.string().min(1)),
});

const LinkSubTicketOutputSchema = z.object({
  subTicketId: z.string(),
  mappingId: z.string(),
  parentTicketId: z.string(),
  mappedTicketId: z.string(),
});

interface LinkSubTicketOutput extends Record<string, unknown> {
  subTicketId: string;
  mappingId: string;
  parentTicketId: string;
  mappedTicketId: string;
}

export class LinkSubTicketStep extends BaseActionStep<
  typeof LinkSubTicketConfigSchema,
  LinkSubTicketOutput
> {
  readonly type = 'LINK_SUB_TICKET';
  readonly configSchema = LinkSubTicketConfigSchema;
  readonly outputSchema = LinkSubTicketOutputSchema;
  readonly name = 'Link a sub-ticket';
  readonly description =
    'Links an existing ticket as a sub-ticket of the parent ticket. A ticket cannot be linked to itself.';
  readonly category = StepCategory.TICKET;
  readonly icon = 'Link';

  async execute(
    config: z.infer<typeof LinkSubTicketConfigSchema>,
    context: AutomationContext,
  ): Promise<LinkSubTicketOutput> {
    const parentTicketId = config.parentTicketId as string;
    const mappedTicketId = config.mappedTicketId as string;

    if (parentTicketId === mappedTicketId) {
      throw new Error('[LINK_SUB_TICKET] A ticket cannot be linked as a sub-ticket of itself');
    }

    const child = await db.ticket.findUnique({
      where: { id: mappedTicketId },
      select: { id: true, title: true, description: true, assignedTo: true, xyneId: true },
    });
    if (!child) {
      throw new Error(`[LINK_SUB_TICKET] Ticket "${mappedTicketId}" not found`);
    }

    const existing = await db.ticketSubTicketMapping.findFirst({
      where: { ticketId: parentTicketId, subTicket: { mappedTicketId } },
      select: { id: true },
    });
    if (existing) {
      throw new Error('[LINK_SUB_TICKET] Ticket is already linked as a sub-ticket of this parent');
    }

    const result = await createSubTicket({
      parentTicketId,
      title: child.title,
      description: child.description,
      assignedTo: child.assignedTo,
      createdBy: context.automation.createdById,
      mappedTicketId,
      subTicketXyneId: child.xyneId,
    });

    logger.info(
      `[automations] LINK_SUB_TICKET → ticket ${mappedTicketId} linked under parent ${result.parentTicketId}`,
    );

    return {
      subTicketId: result.subTicketId,
      mappingId: result.mappingId,
      parentTicketId: result.parentTicketId,
      mappedTicketId,
    };
  }
}

export const linkSubTicketStep = new LinkSubTicketStep();
