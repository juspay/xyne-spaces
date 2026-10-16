import { isFieldActive } from '@xyne/shared';
import type { ResolvedDisplayFormField } from './resolve-ticket-form-fields';
export type TicketFieldValues = Record<string, string | string[]>;
/** Match desktop branch visibility and never submit stale hidden field values. */
export function activeTicketFields(
  fields: readonly ResolvedDisplayFormField[],
  values: TicketFieldValues,
): ResolvedDisplayFormField[] {
  return fields.filter(field =>
    isFieldActive(field, fields, id => {
      const parent = fields.find(candidate => candidate.id === id);
      const value = parent ? values[parent.fieldName] : undefined;
      return typeof value === 'string' ? value : null;
    }),
  );
}
export function ticketDynamicFieldErrors(
  fields: readonly ResolvedDisplayFormField[],
  values: TicketFieldValues,
): string[] {
  return activeTicketFields(fields, values).flatMap(field => {
    const value = values[field.fieldName];
    if (
      !field.isOptional &&
      field.fieldType !== 'DOC' &&
      (!value || (Array.isArray(value) ? !value.length : !value.trim()))
    )
      return [`${field.fieldName} is required`];
    if (
      field.fieldType === 'NUMBER' &&
      typeof value === 'string' &&
      value.trim() &&
      !Number.isFinite(Number(value))
    )
      return [`${field.fieldName} must be a number`];
    return [];
  });
}

export function threadHasTicket(
  conversation:
    | {
        ticketId?: string | null | undefined;
        ticket?: { id: string } | null | undefined;
        metadata?: unknown;
        initialMessage?: { metadata?: unknown } | null | undefined;
      }
    | null
    | undefined,
): boolean {
  const hasMarker = (value: unknown): boolean =>
    !!value &&
    typeof value === 'object' &&
    'ticketId' in value &&
    typeof value.ticketId === 'string' &&
    !!value.ticketId;
  return (
    !!conversation?.ticketId ||
    !!conversation?.ticket ||
    hasMarker(conversation?.metadata) ||
    hasMarker(conversation?.initialMessage?.metadata)
  );
}
