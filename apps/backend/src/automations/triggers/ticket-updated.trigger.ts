import { emitDomainEvent } from '@/events/emitDomainEvent';
import { z } from 'zod';
import { TicketPriority, TicketStatusV2 } from '@xyne/shared';
import { BaseTrigger } from './base-trigger';
import { TriggerCategory } from '../types/categories';
import {
  matchTicketScopeFilters,
  hydrateTicketBoundPayload,
  type TicketLike,
} from './ticket-context';
import type { TicketUpdatedEventPayload } from '../types/automation-events';
import {
  TicketUpdatedFieldSchema,
  FormFieldConditionSchema,
  TicketUpdatedOutputSchema,
  resolveFormFieldConditions,
  matchesFormFieldCondition,
  isTicketReopenTransition,
  type TicketChanges,
  type FormFieldChanges,
} from './ticket-updated-schema';

// Re-exported so every existing importer keeps its import path; the definitions
// moved to a leaf that the engine cannot reach. See `ticket-updated-schema.ts`.
export {
  REOPENED_STATUSES,
  isTicketReopenTransition,
  TicketUpdatedFieldSchema,
  FormFieldConditionMatchSchema,
  FormFieldConditionSchema,
  TicketChangeSchema,
  TicketUpdatedOutputSchema,
  resolveFormFieldConditions,
  matchesFormFieldCondition,
} from './ticket-updated-schema';
export type {
  TicketChange,
  FormFieldCondition,
  TicketChanges,
  FormFieldChanges,
  TicketUpdatedField,
} from './ticket-updated-schema';
import { logger } from '@/utils/logger';

export const TICKET_UPDATED_EVENT = 'TICKET_UPDATED';

const FieldTransitionSchema = z.object({
  field: TicketUpdatedFieldSchema,
  previousValue: z.union([z.string(), z.number()]).nullable().optional(),
  newValue: z.union([z.string(), z.number()]).nullable().optional(),
});

const TicketUpdatedConfigSchema = z.object({
  projectIds: z
    .array(z.string())
    .optional()
    .describe('Limit to tickets on these projects. Empty matches every project.'),
  boardIds: z
    .array(z.string())
    .optional()
    .describe('Limit to tickets on these boards. Empty matches every board.'),
  channelIds: z
    .array(z.string())
    .optional()
    .describe('Limit to tickets posted to these channels. Empty matches every channel.'),
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
});

type TicketUpdatedConfig = z.infer<typeof TicketUpdatedConfigSchema>;
type TicketUpdatedPayload = z.infer<typeof TicketUpdatedOutputSchema>;

export class TicketUpdatedTrigger extends BaseTrigger<typeof TicketUpdatedConfigSchema> {
  readonly type = TICKET_UPDATED_EVENT;
  readonly configSchema = TicketUpdatedConfigSchema;
  readonly outputSchema = TicketUpdatedOutputSchema;
  readonly name = 'When a ticket is updated';
  readonly description =
    'Fires whenever a ticket field changes. Pick which fields qualify, and optionally the exact transition (e.g. priority became Urgent).';
  readonly category = TriggerCategory.EVENT;
  readonly icon = 'PenSquare';

  async hydratePayload(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const hydrated = await hydrateTicketBoundPayload(payload as unknown as TicketUpdatedEventPayload);
    return hydrated as unknown as Record<string, unknown>;
  }

  override decorateConfigSchema(jsonSchema: Record<string, unknown>): Record<string, unknown> {
    const fieldValueSchemas: Record<string, { fieldKey: string; schema: Record<string, unknown> }> = {
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

    const tryAttach = (
      schema: Record<string, unknown> | null | undefined,
    ): boolean => {
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

  override matchFilters(
    filter: Record<string, unknown>,
    payload: Record<string, unknown>,
  ): boolean {
    const cfg = filter as TicketUpdatedConfig;
    const p = payload as TicketUpdatedPayload;
    if (!matchTicketScopeFilters(cfg, p.ticket)) return false;

    const hasTransitionConfig = cfg.transitions && cfg.transitions.length > 0;
    const formFieldConditions = resolveFormFieldConditions(cfg);
    const hasFormFieldConfig = formFieldConditions.length > 0;
    const changedFormFieldIds = new Set(Object.keys(p.formFieldChanges ?? {}));
    const hasStaticChanges = Object.keys(p.changes).length > 0;
    const hasFormFieldChanges = changedFormFieldIds.size > 0;

    const matchesTransition = (rule: z.infer<typeof FieldTransitionSchema>): boolean => {
      const change = p.changes[rule.field];
      if (!change) return false;
      if (
        rule.previousValue !== undefined &&
        String(change.previousValue ?? '') !== String(rule.previousValue ?? '')
      ) {
        return false;
      }
      if (rule.newValue !== undefined) {
        if (String(change.newValue ?? '') !== String(rule.newValue ?? '')) return false;
      } else if (rule.field === 'assignedTo' && (change.newValue === null || change.newValue === undefined)) {
        // No specific target user configured — skip unassignment events (newValue=null).
        return false;
      }
      return true;
    };

    const formFieldMatches =
      hasFormFieldConfig &&
      hasFormFieldChanges &&
      formFieldConditions.some(c => matchesFormFieldCondition(c, p.formFieldChanges));

    const staticMatches = (() => {
      if (!hasStaticChanges) return false;
      if (!hasTransitionConfig) return true;
      return cfg.transitions!.some(matchesTransition);
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
}

export const ticketUpdatedTrigger = new TicketUpdatedTrigger();

export async function emitTicketUpdated(params: {
  ticket: TicketLike;
  changes: TicketChanges;
  formFieldChanges?: FormFieldChanges;
  performedById: string | null;
}): Promise<void> {
  const { ticket, changes, formFieldChanges, performedById } = params;
  if (Object.keys(changes).length === 0 && Object.keys(formFieldChanges ?? {}).length === 0) return;

  // Every path that changes statusV2 funnels through here, so this is the one place
  // a reopen can be observed regardless of which writer produced it (Zero mutators,
  // the ticket repository, the apps API, email ingestion, the classification worker).
  //
  // The cheap transition test runs inline so the common update — which is not a
  // reopen — costs one comparison and nothing else. Only a genuine reopen pays for
  // the module load, which is lazy because the reassignment helper reaches the ticket
  // repository, which imports this module for emitTicketUpdated; a static import
  // would close that loop.
  if (isTicketReopenTransition(changes)) {
    void import('@/utils/ticketReassignment')
      .then(({ reassignReopenedTicketIfAssigneeInactive }) =>
        reassignReopenedTicketIfAssigneeInactive(ticket, changes),
      )
      .catch(err =>
        logger.error(`[automations] reopen reassignment hook failed for ${ticket.id}:`, err),
      );
  }

  try {
    // Lightweight payload: ticketId + the diff + performer id. The trigger's
    // hydratePayload fetches ticket + board + project + channel + ...
    // fresh from the DB when the automation actually runs.
    const payload = {
      ticketId: ticket.id,
      scope: {
        boardId: ticket.boardId ?? null,
        projectId: ticket.projectId ?? null,
        channelId: ticket.channelId ?? null,
      },
      changes,
      formFieldChanges: formFieldChanges ?? {},
      performedBy: { id: performedById },
    };
    await emitDomainEvent(
      { type: TICKET_UPDATED_EVENT, payload },
      ticket.workspaceId,
    );
  } catch (err) {
    logger.error(`[automations] emitTicketUpdated failed for ${ticket.id}:`, err);
  }
}
