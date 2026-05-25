import { z } from 'zod';
import { TicketPriority, TicketStatusV2 } from '@prisma/client';
import { BaseTrigger } from './base-trigger';
import { TriggerCategory } from '../types/categories';
import { eventRouter } from '../engine/event-router';
import {
  TicketContextSchema,
  matchTicketScopeFilters,
  hydrateTicketBoundPayload,
  type TicketLike,
} from './ticket-context';
import type { TicketUpdatedEventPayload } from '../types/automation-events';
import { logger } from '@/utils/logger';

export const TICKET_UPDATED_EVENT = 'TICKET_UPDATED';

export const TicketUpdatedFieldSchema = z.enum([
  'statusV2',
  'assignedTo',
  'priority',
  'stageName',
  'title',
  'description',
  'eta',
  'boardId',
  'userGroupId',
]);
export type TicketUpdatedField = z.infer<typeof TicketUpdatedFieldSchema>;

const FieldTransitionSchema = z.object({
  field: TicketUpdatedFieldSchema,
  previousValue: z.union([z.string(), z.number()]).nullable().optional(),
  newValue: z.union([z.string(), z.number()]).nullable().optional(),
});

const TicketUpdatedConfigSchema = z.object({
  boardIds: z
    .array(z.string())
    .optional()
    .describe('Limit to tickets on these boards. Empty matches every board.'),
  channelIds: z
    .array(z.string())
    .optional()
    .describe('Limit to tickets posted to these channels. Empty matches every channel.'),
  projectIds: z
    .array(z.string())
    .optional()
    .describe('Limit to tickets on these projects. Empty matches every project.'),
  transitions: z
    .array(FieldTransitionSchema)
    .optional()
    .describe(
      'Fire only when at least one of these field transitions occurred. Empty matches any update on the tracked fields.',
    ),
});

const TicketChangeSchema = z.object({
  previousValue: z.union([z.string(), z.number(), z.null()]).optional(),
  newValue: z.union([z.string(), z.number(), z.null()]).optional(),
});

export const TicketUpdatedOutputSchema = TicketContextSchema.extend({
  changes: z.record(TicketUpdatedFieldSchema, TicketChangeSchema),
  performedBy: z.object({
    id: z.string().nullable(),
  }),
});

type TicketUpdatedConfig = z.infer<typeof TicketUpdatedConfigSchema>;
type TicketUpdatedPayload = z.infer<typeof TicketUpdatedOutputSchema>;
type TicketChange = z.infer<typeof TicketChangeSchema>;

export type TicketChanges = Partial<Record<TicketUpdatedField, TicketChange>>;

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
    if (cfg.transitions && cfg.transitions.length > 0) {
      const matchesOne = (rule: z.infer<typeof FieldTransitionSchema>): boolean => {
        const change = p.changes[rule.field];
        if (!change) return false;
        if (
          rule.previousValue !== undefined &&
          String(change.previousValue ?? '') !== String(rule.previousValue ?? '')
        ) {
          return false;
        }
        if (
          rule.newValue !== undefined &&
          String(change.newValue ?? '') !== String(rule.newValue ?? '')
        ) {
          return false;
        }
        return true;
      };
      if (!cfg.transitions.some(matchesOne)) return false;
    }
    return true;
  }
}

export const ticketUpdatedTrigger = new TicketUpdatedTrigger();

export async function emitTicketUpdated(params: {
  ticket: TicketLike;
  changes: TicketChanges;
  performedById: string | null;
}): Promise<void> {
  const { ticket, changes, performedById } = params;
  if (Object.keys(changes).length === 0) return;
  try {
    // Lightweight payload: ticketId + the diff (`changes`, the only thing
    // we can't re-derive at run-time) + performer id. The trigger's
    // hydratePayload fetches ticket + board + project + channel + ...
    // fresh from the DB when the automation actually runs.
    const payload = {
      ticketId: ticket.id,
      changes,
      performedBy: { id: performedById },
    };
    await eventRouter.emit(
      { type: TICKET_UPDATED_EVENT, payload },
      ticket.workspaceId,
    );
  } catch (err) {
    logger.error(`[automations] emitTicketUpdated failed for ${ticket.id}:`, err);
  }
}
