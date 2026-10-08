import type { FieldOptionsContext, FieldOptionsPage } from '@xyne/workflow-sdk';
import { boardOptions, channelOptions, noOptions, optionsQuery, projectOptions } from '../options';
import type { XyneCtx } from '@/workflowsV2/types';
import { z } from 'zod';
import { requireScopeFilter } from '../scope-filter';
import { EventTrigger, TriggerCategory, withOptions } from '@xyne/workflow-sdk';
import type { HydrateResult, TriggerEvent } from '@xyne/workflow-sdk';
import {
  TicketContextSchema,
  matchTicketScopeFilters,
  hydrateTicketBoundPayload,
} from '@/automations/triggers/ticket-context';
import {
  TicketChangeSchema,
  FormFieldConditionSchema,
  type FormFieldCondition,
} from '@/automations/triggers/ticket-updated-schema';
import type { TicketCreatedEventPayload } from '@/automations/types/automation-events';

export const TICKET_CREATED_EVENT = 'TICKET_CREATED';

const TicketCreatedConfigSchema = z
  .object({
    boardIds: withOptions(z
      .array(z.string()))
      .optional()
      .describe('Limit to tickets on these boards. Empty matches every board you can see.'),
    projectIds: withOptions(z
      .array(z.string()))
      .optional()
      .describe('Limit to tickets on these projects. Empty matches every project.'),
    channelIds: withOptions(z
      .array(z.string()))
      .optional()
      .describe('Limit to tickets posted to these channels. Empty matches every channel.'),
    formFieldConditions: z
      .array(FormFieldConditionSchema)
      .optional()
      .describe(
        'Fire only when form fields are set at creation and optional value filters match (contains).',
      ),
  })
  .superRefine(requireScopeFilter());

export const TicketCreatedOutputSchema = TicketContextSchema.extend({
  formFieldChanges: z.record(z.string(), TicketChangeSchema).optional(),
  performedBy: z
    .object({
      id: z.string().nullable(),
    })
    .optional(),
});

type TicketCreatedConfig = z.infer<typeof TicketCreatedConfigSchema>;
type TicketCreatedPayload = z.infer<typeof TicketCreatedOutputSchema>;

export class TicketCreatedTrigger extends EventTrigger<
  typeof TicketCreatedConfigSchema,
  typeof TicketCreatedOutputSchema,
  TicketCreatedEventPayload & Record<string, unknown>
> {
  readonly type = TICKET_CREATED_EVENT;
  readonly configSchema = TicketCreatedConfigSchema;
  readonly outputSchema = TicketCreatedOutputSchema;
  readonly name = 'When a ticket is created';
  readonly description =
    'Fires whenever a new ticket is created. Filter by board, project, or channel.';
  readonly category = TriggerCategory.EVENT;
  readonly icon = 'Ticket';
  readonly requiresScopeFilter = true;

  override getOptions(
    ctx: FieldOptionsContext<TicketCreatedConfig, Record<string, unknown>, XyneCtx>,
  ): Promise<FieldOptionsPage> {
    const query = optionsQuery(ctx);
    switch (ctx.field) {
      case 'boardIds':
        return boardOptions(query, ctx.literal.projectIds);
      case 'projectIds':
        return projectOptions(query);
      case 'channelIds':
        return channelOptions(query, ctx.literal.projectIds);
      default:
        return Promise.resolve(noOptions);
    }
  }

  override accepts(
    event: TriggerEvent<TicketCreatedEventPayload & Record<string, unknown>>,
    config: TicketCreatedConfig,
  ): boolean {
    const { scope, formFieldChanges } = event.payload;
    if (!matchTicketScopeFilters(config, scope)) return false;

    const formFieldConditions: FormFieldCondition[] = (config.formFieldConditions ?? []).map(
      (c) => ({
        fieldId: c.fieldId,
        match: c.match ?? 'changed',
        value: c.value,
      }),
    );
    if (formFieldConditions.length === 0) return true;

    return formFieldConditions.some((c) => {
      const change = formFieldChanges?.[c.fieldId];
      if (!change) return false;
      if ((c.match ?? 'changed') === 'changed') return true;
      const needle = (c.value ?? '').toString().trim();
      if (!needle) return false;
      if (change.newValue === null || change.newValue === undefined) return false;
      return String(change.newValue).toLowerCase().includes(needle.toLowerCase());
    });
  }

  /** Ids into objects — the same read automations does, unchanged. */
  override async hydrate(
    event: TriggerEvent<TicketCreatedEventPayload & Record<string, unknown>>,
  ): Promise<HydrateResult<TicketCreatedPayload>> {
    const hydrated = await hydrateTicketBoundPayload(event.payload);
    return { kind: 'payload', payload: hydrated as unknown as TicketCreatedPayload };
  }

  /** One ticket, one read — however many workflows are bound to this event. */
  override hydrationKey(
    event: TriggerEvent<TicketCreatedEventPayload & Record<string, unknown>>,
  ): string | undefined {
    return event.payload.ticketId;
  }
}
