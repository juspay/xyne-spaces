import { z } from 'zod';
import { TicketStatusV2 } from '@xyne/shared';
import { TicketContextSchema } from './ticket-context';

/**
 * The ticket-update vocabulary: which fields count as a change, what a change
 * looks like, and the form-field conditions an author writes against it.
 *
 * A leaf on purpose. These are shared by the TICKET_UPDATED trigger, the
 * TICKET_CREATED trigger and their ported counterparts — and the trigger files
 * they used to live in also hold the *emitters*, which repositories call. That
 * put a plain schema on the far side of the whole automation engine: importing
 * one dragged the engine in, and the engine reaches back into trigger files, so
 * the graph closed on itself. Nothing here imports anything but zod and the
 * ticket context, so nothing can.
 */

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


export const FormFieldConditionMatchSchema = z.enum(['changed', 'contains']);

export const FormFieldConditionSchema = z
  .object({
    fieldId: z.string().min(1),
    match: FormFieldConditionMatchSchema.default('changed'),
    value: z
      .string()
      .optional()
      .describe('Substring to look for in the new field value when match is "contains".'),
  })
  .superRefine((val, ctx) => {
    if (val.match === 'contains' && !(val.value ?? '').trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A contains value is required when match is "contains".',
        path: ['value'],
      });
    }
  });
export type FormFieldCondition = z.infer<typeof FormFieldConditionSchema>;


export const TicketChangeSchema = z.object({
  previousValue: z.union([z.string(), z.number(), z.null()]).optional(),
  newValue: z.union([z.string(), z.number(), z.null()]).optional(),
});

export const TicketUpdatedOutputSchema = TicketContextSchema.extend({
  changes: z.record(TicketUpdatedFieldSchema, TicketChangeSchema),
  formFieldChanges: z.record(z.string(), TicketChangeSchema).optional(),
  performedBy: z.object({
    id: z.string().nullable(),
  }),
});


export type TicketChange = z.infer<typeof TicketChangeSchema>;

export type TicketChanges = Partial<Record<TicketUpdatedField, TicketChange>>;

/**
 * Statuses a ticket can come back to from COMPLETED. Mirrors the reopen definition
 * used for desk metrics (deskMetricsRepository's reopenedPredicate) so "reopened"
 * means one thing across the product.
 */
export const REOPENED_STATUSES: string[] = [
  TicketStatusV2.TODO,
  TicketStatusV2.STARTED,
  TicketStatusV2.PAUSED,
];

/** True when this diff represents a completed ticket being brought back to life. */
export function isTicketReopenTransition(changes: TicketChanges): boolean {
  const statusChange = changes.statusV2;
  if (!statusChange) return false;
  return (
    statusChange.previousValue === TicketStatusV2.COMPLETED &&
    REOPENED_STATUSES.includes(String(statusChange.newValue))
  );
}
export type FormFieldChanges = Record<string, TicketChange>;

/** Normalize legacy formFieldIds into formFieldConditions (match: changed). */
export function resolveFormFieldConditions(cfg: {
  formFieldConditions?: readonly FormFieldCondition[] | undefined;
  formFieldIds?: readonly string[] | undefined;
}): FormFieldCondition[] {
  if (cfg.formFieldConditions && cfg.formFieldConditions.length > 0) {
    return cfg.formFieldConditions.map(c => ({
      fieldId: c.fieldId,
      match: c.match ?? 'changed',
      value: c.value,
    }));
  }
  if (cfg.formFieldIds && cfg.formFieldIds.length > 0) {
    return cfg.formFieldIds.map(fieldId => ({ fieldId, match: 'changed' as const }));
  }
  return [];
}

export function matchesFormFieldCondition(
  condition: FormFieldCondition,
  formFieldChanges: FormFieldChanges | undefined,
): boolean {
  const change = formFieldChanges?.[condition.fieldId];
  if (!change) return false;

  const match = condition.match ?? 'changed';
  if (match === 'changed') return true;

  const needle = (condition.value ?? '').trim();
  if (!needle) return false;
  if (change.newValue === null || change.newValue === undefined) return false;
  return String(change.newValue).toLowerCase().includes(needle.toLowerCase());
}

