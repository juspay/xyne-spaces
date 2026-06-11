import { FormFieldType } from '@xyne/shared';
import type { Prisma } from '@prisma/client';
import type { VespaTicketFormField } from '@/vespa/src/types';

export type TicketDynamicFieldValue = {
  fieldId: string;
  actualFieldValue: Prisma.JsonValue | null;
};

export const normalizeVespaFieldValue = (value: Prisma.JsonValue): string | null => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(normalizeVespaFieldValue).filter(Boolean).join(',');
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const candidate =
      record.id ??
      record.value ??
      record.label ??
      record.name ??
      record.fieldValue;

    if (typeof candidate === 'string' && candidate.length > 0) return candidate;
    if (typeof candidate === 'number' || typeof candidate === 'boolean') return String(candidate);

    try {
      return JSON.stringify(value);
    } catch {
      return null;
    }
  }
  return null;
};

/**
 * Convert ticket form values into the Vespa wire format:
 * [{ fieldId, fieldValue }].
 */
export const buildFormFields = (
  values: TicketDynamicFieldValue[],
  fieldTypeByFieldId: Map<string, FormFieldType>,
): VespaTicketFormField[] => {
  const formFields: VespaTicketFormField[] = [];

  for (const value of values) {
    const rawValue = value.actualFieldValue;
    if (rawValue === null || rawValue === undefined) continue;

    const fieldType = fieldTypeByFieldId.get(value.fieldId);
    const normalizedValues: string[] = [];

    const pushValue = (tokenValue: string | null): void => {
      if (!tokenValue) return;
      normalizedValues.push(tokenValue);
    };

    if (fieldType === FormFieldType.MULTI_SELECT || fieldType === FormFieldType.USER) {
      if (Array.isArray(rawValue)) {
        rawValue.forEach(item => pushValue(normalizeVespaFieldValue(item)));
      } else {
        pushValue(normalizeVespaFieldValue(rawValue));
      }
    } else if (Array.isArray(rawValue)) {
      rawValue.forEach(item => pushValue(normalizeVespaFieldValue(item)));
    } else {
      pushValue(normalizeVespaFieldValue(rawValue));
    }

    if (normalizedValues.length > 0) {
      Array.from(new Set(normalizedValues)).forEach(fieldValue => {
        formFields.push({
          fieldId: value.fieldId,
          fieldValue,
        });
      });
    }
  }

  return formFields;
};
