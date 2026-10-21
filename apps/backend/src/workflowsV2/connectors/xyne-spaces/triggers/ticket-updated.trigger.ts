import type { FieldOptionsContext, FieldOptionsPage } from '@xyne/workflow-sdk';
import { boardOptions, channelOptions, noOptions, optionsQuery, projectOptions } from '../options';
import type { XyneCtx } from '@/workflowsV2/types';
import { z } from 'zod';
import { requireScopeFilter } from '../scope-filter';
import { TicketPriority, TicketStatusV2 } from '@xyne/shared';
import { EventTrigger, TriggerCategory, withOptions } from '@xyne/workflow-sdk';
import type { HydrateResult, TriggerEvent } from '@xyne/workflow-sdk';
import {
  matchTicketScopeFilters,
  hydrateTicketBoundPayload,
} from '@/automations/triggers/ticket-context';
import {
  TicketUpdatedFieldSchema,
  TicketUpdatedOutputSchema,
  FormFieldConditionSchema,
  resolveFormFieldConditions,
  matchesFormFieldCondition,
} from '@/automations/triggers/ticket-updated-schema';
import type { TicketUpdatedEventPayload } from '@/automations/types/automation-events';

export const TICKET_UPDATED_EVENT = 'TICKET_UPDATED';

const FieldTransitionSchema = z.object({
  field: TicketUpdatedFieldSchema,
  previousValue: z.union([z.string(), z.number()]).nullable().optional(),
  newValue: z.union([z.string(), z.number()]).nullable().optional(),
});

const TicketUpdatedConfigSchema = z
  .object({
    boardIds: withOptions(z
      .array(z.string()))
      .optional()
      .describe('Limit to tickets on these boards. Empty matches every board.'),
    channelIds: withOptions(z
      .array(z.string()))
      .optional()
      .describe('Limit to tickets posted to these channels. Empty matches every channel.'),
    projectIds: withOptions(z
      .array(z.string()))
      .optional()
      .describe('Limit to tickets on these projects. Empty matches every project.'),
    transitions: z
      .array(FieldTransitionSchema)
      .optional()
      .describe(
        'Fire only when at least one of these field transitions occurred. Empty matches any update on the tracked fields.',
      ),
    formFieldIds: z
      .array(z.string())
      .optional()
      .describe(
        'Fire only when any of these form fields changed. Leave empty to skip form field tracking entirely. Prefer formFieldConditions for contains matching.',
      ),
    formFieldConditions: z
      .array(FormFieldConditionSchema)
      .optional()
      .describe(
        'Fire when form fields change and optional value filters match. Prefer this over formFieldIds.',
      ),
  })
  .superRefine(requireScopeFilter());

type TicketUpdatedConfig = z.infer<typeof TicketUpdatedConfigSchema>;
type TicketUpdatedPayload = z.infer<typeof TicketUpdatedOutputSchema>;
type Raw = TicketUpdatedEventPayload & Record<string, unknown>;

export class TicketUpdatedTrigger extends EventTrigger<
  typeof TicketUpdatedConfigSchema,
  typeof TicketUpdatedOutputSchema,
  Raw
> {
  readonly type = TICKET_UPDATED_EVENT;
  readonly configSchema = TicketUpdatedConfigSchema;
  readonly outputSchema = TicketUpdatedOutputSchema;
  readonly name = 'When a ticket is updated';
  readonly description =
    'Fires whenever a ticket field changes. Pick which fields qualify, and optionally the exact transition (e.g. priority became Urgent).';
  readonly category = TriggerCategory.EVENT;
  readonly icon = 'PenSquare';
  readonly requiresScopeFilter = true;

  override getOptions(
    ctx: FieldOptionsContext<TicketUpdatedConfig, Record<string, unknown>, XyneCtx>,
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

  override accepts(event: TriggerEvent<Raw>, config: TicketUpdatedConfig): boolean {
    const { scope, changes, formFieldChanges } = event.payload;
    if (!matchTicketScopeFilters(config, scope)) return false;

    const hasTransitionConfig = config.transitions && config.transitions.length > 0;
    const formFieldConditions = resolveFormFieldConditions(config);
    const hasFormFieldConfig = formFieldConditions.length > 0;
    const changedFormFieldIds = new Set(Object.keys(formFieldChanges ?? {}));
    const hasStaticChanges = Object.keys(changes).length > 0;
    const hasFormFieldChanges = changedFormFieldIds.size > 0;

    const matchesTransition = (rule: z.infer<typeof FieldTransitionSchema>): boolean => {
      const change = changes[rule.field];
      if (!change) return false;
      if (
        rule.previousValue !== undefined &&
        String(change.previousValue ?? '') !== String(rule.previousValue ?? '')
      ) {
        return false;
      }
      if (rule.newValue !== undefined) {
        if (String(change.newValue ?? '') !== String(rule.newValue ?? '')) return false;
      } else if (
        rule.field === 'assignedTo' &&
        (change.newValue === null || change.newValue === undefined)
      ) {
        // No specific target user configured — skip unassignment events (newValue=null).
        return false;
      }
      return true;
    };

    const formFieldMatches =
      hasFormFieldConfig &&
      hasFormFieldChanges &&
      formFieldConditions.some((c) => matchesFormFieldCondition(c, formFieldChanges));

    const staticMatches = (() => {
      if (!hasStaticChanges) return false;
      if (!hasTransitionConfig) return true;
      return config.transitions!.some(matchesTransition);
    })();

    // Neither configured → legacy: fire on any static field update; skip pure form events.
    if (!hasTransitionConfig && !hasFormFieldConfig) {
      return hasStaticChanges;
    }

    // Form-field-only rule (e.g. Desk auto-label): never fire on unrelated static updates.
    if (!hasTransitionConfig && hasFormFieldConfig) {
      return !!formFieldMatches;
    }

    // Transition-only rule.
    if (hasTransitionConfig && !hasFormFieldConfig) {
      return staticMatches;
    }

    // Both configured: fire if either side matches.
    return staticMatches || !!formFieldMatches;
  }

  override async hydrate(event: TriggerEvent<Raw>): Promise<HydrateResult<TicketUpdatedPayload>> {
    const hydrated = await hydrateTicketBoundPayload(event.payload);
    return { kind: 'payload', payload: hydrated as unknown as TicketUpdatedPayload };
  }

  override hydrationKey(event: TriggerEvent<Raw>): string | undefined {
    return event.payload.ticketId;
  }


  override decorateConfigSchema(jsonSchema: Record<string, unknown>): Record<string, unknown> {
    const fieldValueSchemas: Record<
      string,
      { fieldKey: string; schema: Record<string, unknown> }
    > = {
      statusV2: {
        fieldKey: 'statusV2',
        schema: { type: 'string', enum: Object.values(TicketStatusV2) },
      },
      priority: {
        fieldKey: 'priority',
        schema: { type: 'string', enum: Object.values(TicketPriority) },
      },
      assignedTo: { fieldKey: 'userId', schema: { type: 'string' } },
      boardId: { fieldKey: 'boardId', schema: { type: 'string' } },
      userGroupId: { fieldKey: 'userGroupId', schema: { type: 'string' } },
      stageName: { fieldKey: 'stageName', schema: { type: 'string' } },
      eta: { fieldKey: 'eta', schema: { type: 'number' } },
      title: { fieldKey: 'title', schema: { type: 'string' } },
      description: { fieldKey: 'description', schema: { type: 'string' } },
    };
    const discriminator = {
      field: 'field',
      valueFields: ['previousValue', 'newValue'],
      schemas: fieldValueSchemas,
    };

    const tryAttach = (schema: Record<string, unknown> | null | undefined): boolean => {
      if (!schema || typeof schema !== 'object') return false;
      const properties = schema['properties'] as Record<string, unknown> | undefined;
      const transitions = properties?.['transitions'] as Record<string, unknown> | undefined;
      const items = transitions?.['items'] as Record<string, unknown> | undefined;
      if (!items || typeof items !== 'object') return false;
      items['x-discriminator'] = discriminator;
      return true;
    };

    if (tryAttach(jsonSchema)) return jsonSchema;
    const defs = jsonSchema['definitions'] as Record<string, unknown> | undefined;
    if (defs) {
      for (const def of Object.values(defs)) {
        if (tryAttach(def as Record<string, unknown>)) break;
      }
    }
    return jsonSchema;
  }
}
