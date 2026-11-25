import type { FieldOptionsContext, FieldOptionsPage } from '@xyne/workflow-sdk';
import { boardOptions, noOptions, optionsQuery } from '../options';
import type { XyneCtx } from '@/workflowsV2/types';
import { z } from 'zod/v3';
import { EventTrigger, TriggerCategory, withOptions } from '@xyne/workflow-sdk';
import type { HydrateResult, TriggerEvent } from '@xyne/workflow-sdk';
import {
  matchTicketScopeFilters,
  hydrateTicketBoundPayload,
} from '@/automations/triggers/ticket-context';
import { TicketContextSchema } from '../schemas';
import { boardIssues, channelIssues, projectIssues } from '../validation';
import type { Checked, ConfigIssue } from '../validation';
import type { TicketCreatedEventPayload } from '@/automations/types/automation-events';
import { TICKET_CREATED_EVENT } from '@/automations/triggers/ticket-created.trigger';

const TicketCreatedConfigSchema = z
  .object({
    boardIds: withOptions(z
      .array(z.string()))
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
  })
  .refine((config) => config.boardIds?.length || config.projectIds?.length || config.channelIds?.length, {
    message: 'Scope this workflow by at least one board, project or channel, so it does not fire on every ticket.',
  });

const TicketCreatedOutputSchema = TicketContextSchema.extend({
  /** The form fields the ticket was created with, by field name, id and lowercase name. */
  formFieldChanges: z
    .record(
      z.string(),
      z.object({
        previousValue: z.union([z.string(), z.number(), z.null()]).optional(),
        newValue: z.union([z.string(), z.number(), z.null()]).optional(),
      }),
    )
    .optional(),
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
    return ctx.field === 'boardIds' ? boardOptions(optionsQuery(ctx)) : Promise.resolve(noOptions);
  }

  override async validateConfig(
    ctx: Checked<{ boardIds?: string[]; projectIds?: string[]; channelIds?: string[] }>,
  ): Promise<ConfigIssue[]> {
    const { boardIds, projectIds, channelIds } = ctx.known;
    return (
      await Promise.all([
        boardIssues(ctx, 'boardIds', boardIds),
        projectIssues(ctx, 'projectIds', projectIds),
        channelIssues(ctx, 'channelIds', channelIds),
      ])
    ).flat();
  }

  override accepts(
    event: TriggerEvent<TicketCreatedEventPayload & Record<string, unknown>>,
    config: TicketCreatedConfig,
  ): boolean {
    return matchTicketScopeFilters(config, event.payload.scope);
  }

  /** Ids into objects — the same read automations does, unchanged. */
  override async hydrate(
    event: TriggerEvent<TicketCreatedEventPayload & Record<string, unknown>>,
  ): Promise<HydrateResult<TicketCreatedPayload>> {
    const hydrated = await hydrateTicketBoundPayload(event.payload);
    return { kind: 'payload', payload: hydrated as unknown as TicketCreatedPayload };
  }
}
