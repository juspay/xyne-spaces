import { z } from 'zod';
import { BaseActionStep } from './base-step';
import { StepCategory } from '../types/categories';
import type { AutomationContext } from '../types/context';
import { variableRef } from '../engine/variable-ref';
import { repositories } from '@/database/repositories';

const ArchiveTicketConfigSchema = z.object({
  ticketId: variableRef(z.string().min(1)),
  archived: z.boolean().default(true),
});

const ArchiveTicketOutputSchema = z.object({
  ticketId: z.string(),
  archived: z.boolean(),
});

interface ArchiveTicketOutput extends Record<string, unknown> {
  ticketId: string;
  archived: boolean;
}

export class ArchiveTicketStep extends BaseActionStep<typeof ArchiveTicketConfigSchema, ArchiveTicketOutput> {
  readonly type = 'ARCHIVE_TICKET';
  readonly configSchema = ArchiveTicketConfigSchema;
  readonly outputSchema = ArchiveTicketOutputSchema;
  readonly name = 'Archive a ticket';
  readonly description =
    'Archives the chosen ticket. Pass archived=false to restore it from archive.';
  readonly category = StepCategory.TICKET;
  readonly icon = 'Archive';

  async execute(
    config: z.infer<typeof ArchiveTicketConfigSchema>,
    context: AutomationContext,
  ): Promise<ArchiveTicketOutput> {
    const ticketId = config.ticketId as string;
    const archived = config.archived;
    await repositories.tickets.updateTicketFields(
      ticketId,
      { isArchived: archived },
      context.automation.createdById,
    );
    return { ticketId, archived };
  }
}

export const archiveTicketStep = new ArchiveTicketStep();
