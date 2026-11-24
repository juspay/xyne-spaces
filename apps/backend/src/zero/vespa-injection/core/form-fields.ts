import { FormFieldType } from '@xyne/shared';
import type { Prisma } from '@prisma/client';
import type { VespaTicketFormField } from '@/vespa/src/types';

export type TicketDynamicFieldValue = {
  fieldId: string;
  value: Prisma.JsonValue | null;
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

const normalizeVespaDateFieldValue = (value: Prisma.JsonValue): string | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString().slice(0, 10);
  }

  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) return null;

  if (/^\d+$/.test(trimmed)) {
    const timestamp = Number(trimmed);
    if (!Number.isFinite(timestamp)) return null;
    return new Date(timestamp).toISOString().slice(0, 10);
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return trimmed.length >= 10 ? trimmed.slice(0, 10) : null;
  }

  return parsed.toISOString().slice(0, 10);
};

const normalizeVespaDateFieldLong = (value: Prisma.JsonValue): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) return null;

  if (/^\d+$/.test(trimmed)) {
    const timestamp = Number(trimmed);
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
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
    const rawValue = value.value;
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
    } else if (fieldType === FormFieldType.DATE) {
      const fieldValueLong = normalizeVespaDateFieldLong(rawValue);
      const fieldValue = normalizeVespaDateFieldValue(rawValue);
      if (fieldValueLong !== null && fieldValue !== null) {
        formFields.push({
          fieldId: value.fieldId,
          fieldValue,
          fieldValueLong,
        });
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

export type TicketDynamicFieldRow = TicketDynamicFieldValue & { version?: number | null; updatedAt?: Date };

const GRAM_FIELD_TYPES = new Set<FormFieldType>([FormFieldType.STRING, FormFieldType.NUMBER]);

/**
 * formFieldGrams entries: "<fieldId>::<value>" for the latest value (highest version, then newest) of every STRING or
 * NUMBER field. The encryption gateway splits each value into hashed "<fieldId>::<gram>" tokens (vespa-core ticket.sd,
 * formFieldGrams); the backend never builds grams.
 */
export const buildFormFieldGramEntries = (
  values: TicketDynamicFieldRow[],
  fieldTypeByFieldId: Map<string, FormFieldType>,
): string[] => {
  const latest = new Map<string, TicketDynamicFieldRow>();
  for (const value of values) {
    const fieldType = fieldTypeByFieldId.get(value.fieldId);
    if (!fieldType || !GRAM_FIELD_TYPES.has(fieldType)) continue;
    const raw = value.value;
    if (!(typeof raw === 'number' && Number.isFinite(raw)) && !(typeof raw === 'string' && raw.trim())) continue;
    const current = latest.get(value.fieldId);
    const isNewer =
      !current ||
      (value.version ?? 1) > (current.version ?? 1) ||
      ((value.version ?? 1) === (current.version ?? 1) &&
        (value.updatedAt?.getTime() ?? 0) > (current.updatedAt?.getTime() ?? 0));
    if (isNewer) latest.set(value.fieldId, value);
  }
  return [...latest].map(([fieldId, value]) => `${fieldId}::${String(value.value)}`);
};
