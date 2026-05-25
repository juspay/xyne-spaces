import { z } from 'zod';
import { BaseTrigger } from './base-trigger';
import { TriggerCategory } from '../types/categories';
import {
  TicketContextSchema,
  matchTicketScopeFilters,
  hydrateTicketBoundPayload,
} from './ticket-context';
import type { TicketCreatedEventPayload } from '../types/automation-events';

export const TICKET_CREATED_EVENT = 'TICKET_CREATED';

const TicketCreatedConfigSchema = z.object({
  boardIds: z
    .array(z.string())
    .optional()
    .describe('Limit to tickets on these boards. Empty matches every board you can see.'),
  projectIds: z
    .array(z.string())
    .optional()
    .describe('Limit to tickets on these projects. Empty matches every project.'),
  channelIds: z
    .array(z.string())
    .optional()
    .describe('Limit to tickets posted to these channels. Empty matches every channel.'),
});

export const TicketCreatedOutputSchema = TicketContextSchema;

type TicketCreatedConfig = z.infer<typeof TicketCreatedConfigSchema>;

export class TicketCreatedTrigger extends BaseTrigger<typeof TicketCreatedConfigSchema> {
  readonly type = TICKET_CREATED_EVENT;
  readonly configSchema = TicketCreatedConfigSchema;
  readonly outputSchema = TicketCreatedOutputSchema;
  readonly name = 'When a ticket is created';
  readonly description = 'Fires whenever a new ticket is created. Filter by board, project, or channel.';
  readonly category = TriggerCategory.EVENT;
  readonly icon = 'Ticket';

  async hydratePayload(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const hydrated = await hydrateTicketBoundPayload(payload as unknown as TicketCreatedEventPayload);
    return hydrated as unknown as Record<string, unknown>;
  }

  override matchFilters(
    filter: Record<string, unknown>,
    payload: Record<string, unknown>,
  ): boolean {
    const cfg = filter as TicketCreatedConfig;
    const ticket = (
      payload as {
        ticket?: { boardId?: string | null; projectId?: string | null; channelId?: string | null };
      }
    ).ticket;
    return matchTicketScopeFilters(cfg, ticket);
  }
}

export const ticketCreatedTrigger = new TicketCreatedTrigger();
