import { z } from 'zod';
import { BaseTrigger } from './base-trigger';
import { TriggerCategory } from '../types/categories';
import {
  TicketContextSchema,
  matchTicketScopeFilters,
  hydrateTicketBoundPayload,
} from './ticket-context';
import type { TicketCreatedEventPayload } from '../types/automation-events';
import {
  TicketChangeSchema,
  FormFieldConditionSchema,
  type FormFieldCondition,
} from './ticket-updated.trigger';

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
  formFieldConditions: z
    .array(FormFieldConditionSchema)
    .optional()
    .describe(
      'Fire only when form fields are set at creation and optional value filters match (contains).',
    ),
});

export const TicketCreatedOutputSchema = TicketContextSchema.extend({
  formFieldChanges: z.record(z.string(), TicketChangeSchema).optional(),
  performedBy: z.object({
    id: z.string().nullable(),
  }).optional(),
});

type TicketCreatedConfig = z.infer<typeof TicketCreatedConfigSchema>;
type TicketCreatedPayload = z.infer<typeof TicketCreatedOutputSchema>;

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
    const p = payload as TicketCreatedPayload;
    const ticket = (
      payload as {
        ticket?: { boardId?: string | null; projectId?: string | null; channelId?: string | null };
      }
    ).ticket;
    if (!matchTicketScopeFilters(cfg, ticket)) return false;

    const formFieldConditions: FormFieldCondition[] = (cfg.formFieldConditions ?? []).map(c => ({
      fieldId: c.fieldId,
      match: c.match ?? 'changed',
      value: c.value,
    }));
    if (formFieldConditions.length === 0) return true;

    return formFieldConditions.some(c => {
      const change = p.formFieldChanges?.[c.fieldId];
      if (!change) return false;
      if ((c.match ?? 'changed') === 'changed') return true;
      const needle = (c.value ?? '').toString().trim();
      if (!needle) return false;
      if (change.newValue === null || change.newValue === undefined) return false;
      return String(change.newValue).toLowerCase().includes(needle.toLowerCase());
    });
  }
}

export const ticketCreatedTrigger = new TicketCreatedTrigger();
